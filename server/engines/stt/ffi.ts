import { dlopen, FFIType, type Pointer, ptr, toArrayBuffer } from 'bun:ffi';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import type { TranscriptSegment } from '../types';

const { ptr: P, cstring, i32, i64_fast, f32, void: V } = FFIType;

const SYMBOLS = {
  crispasr_session_open_with_params: { args: [cstring, cstring, P], returns: P },
  crispasr_session_backend: { args: [P], returns: cstring },
  crispasr_session_close: { args: [P], returns: V },
  crispasr_session_set_hotwords: { args: [P, cstring, f32], returns: i32 },
  crispasr_session_transcribe_lang: { args: [P, P, i32, cstring], returns: P },
  crispasr_session_result_n_segments: { args: [P], returns: i32 },
  crispasr_session_result_segment_text: { args: [P, i32], returns: cstring },
  crispasr_session_result_segment_t0: { args: [P, i32], returns: i64_fast },
  crispasr_session_result_segment_t1: { args: [P, i32], returns: i64_fast },
  crispasr_session_result_n_words: { args: [P, i32], returns: i32 },
  crispasr_session_result_word_text: { args: [P, i32, i32], returns: cstring },
  crispasr_session_result_word_t0: { args: [P, i32, i32], returns: i64_fast },
  crispasr_session_result_word_t1: { args: [P, i32, i32], returns: i64_fast },
  crispasr_session_result_word_p: { args: [P, i32, i32], returns: f32 },
  crispasr_session_result_free: { args: [P], returns: V },
  crispasr_vad_slices: {
    args: [cstring, P, i32, i32, f32, i32, i32, i32, f32, i32, P],
    returns: i32,
  },
  crispasr_vad_free: { args: [P], returns: V },
  crispasr_detect_language_pcm: {
    args: [P, i32, i32, cstring, i32, i32, i32, i32, P, i32, P],
    returns: i32,
  },
} as const;

const SR = 16_000;
const cstr = (s: string) => Buffer.from(`${s}\0`);

/** dlopen libcrispasr; the error names the path and how to get a working lib. */
export function dlopenCrispasr(libPath: string) {
  try {
    return dlopen(libPath, SYMBOLS);
  } catch (e) {
    const what = existsSync(libPath) ? 'cannot be loaded' : 'not found';
    throw new Error(
      `libcrispasr ${what} at ${libPath} — run \`bash scripts/crispasr/build.sh\` or set CRISPASR_LIB (${(e as Error).message})`,
    );
  }
}

/** Thin synchronous wrapper over the libcrispasr session C API (child process only). */
export function openCrispasr(libPath: string) {
  const { symbols: L, close } = dlopenCrispasr(libPath);
  const warnedVadRc = new Set<number>();

  function openSession(modelPath: string, threads: number, useGpu: boolean): Pointer | null {
    // crispasr_open_params_v1: abi_version, n_threads, use_gpu, verbosity, + v2 fields/padding (12 ints).
    const params = new Int32Array([1, threads, useGpu ? 1 : 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    return L.crispasr_session_open_with_params(
      cstr(modelPath),
      null,
      ptr(params),
    ) as Pointer | null;
  }

  /** Silero speech spans in seconds: [] = VAD ran and heard no speech, null = VAD could not run. */
  function vadSlices(
    vadModel: string,
    pcm: Float32Array,
    maxChunkSec: number,
    threads: number,
    opts: { threshold?: number; minSilenceMs?: number; padMs?: number } = {},
  ): [number, number][] | null {
    // libcrispasr >= v0.8.41 returns -3 for a model it cannot load, and with scripts/crispasr/crisp-vad-inference-error.patch also when Silero fails;
    // without the patch a failed inference still reads as 0 ("no speech"); older builds also need the missing-file check.
    if (!existsSync(vadModel)) return null;
    const out = new BigUint64Array(1);
    // Values <= 0 select libcrispasr defaults (threshold 0.5, min silence 100 ms); Silero ctx is cached per model.
    const n = L.crispasr_vad_slices(
      cstr(vadModel),
      ptr(pcm),
      pcm.length,
      SR,
      opts.threshold ?? 0,
      0,
      opts.minSilenceMs ?? 0,
      opts.padMs ?? 30,
      maxChunkSec,
      threads,
      ptr(out),
    );
    if (n < 0) {
      if (!warnedVadRc.has(n)) {
        warnedVadRc.add(n);
        // Runs in the STT child (no pino); stderr reaches the server log. Basename + rc only.
        process.stderr.write(
          `[stt-child] warn: crispasr_vad_slices rc=${n} on ${basename(vadModel)} (-3 = model unloadable or inference failed)\n`,
        );
      }
      return null;
    }
    if (n === 0 || out[0] === 0n) return [];
    // Copy out of native memory before freeing it; toArrayBuffer is a view, not a copy.
    const spans = new Float32Array(toArrayBuffer(Number(out[0]) as Pointer, 0, n * 2 * 4)).slice();
    L.crispasr_vad_free(Number(out[0]) as Pointer);
    const res: [number, number][] = [];
    for (let i = 0; i < n; i++) res.push([spans[i * 2], spans[i * 2 + 1]]);
    return res;
  }

  function detectLanguage(lidModel: string, pcm: Float32Array, threads: number): string | null {
    const buf = Buffer.alloc(16);
    const conf = new Float32Array(1);
    const head = pcm.subarray(0, Math.min(pcm.length, 30 * SR));
    const rc = L.crispasr_detect_language_pcm(
      ptr(head),
      head.length,
      0,
      cstr(lidModel),
      threads,
      0,
      0,
      0,
      ptr(buf),
      buf.length,
      ptr(conf),
    );
    return rc === 0 ? buf.toString('utf8', 0, buf.indexOf(0)) : null;
  }

  /** Transcribe one span; timestamps are shifted by `offsetSec`. Returns null when the library fails. */
  function transcribe(
    s: Pointer,
    pcm: Float32Array,
    lang: string | null,
    words: boolean,
    offsetSec: number,
  ): TranscriptSegment[] | null {
    const r = L.crispasr_session_transcribe_lang(
      s,
      ptr(pcm),
      pcm.length,
      lang ? cstr(lang) : null,
    ) as Pointer | null;
    if (!r) return null;
    try {
      const segs: TranscriptSegment[] = [];
      const n = L.crispasr_session_result_n_segments(r);
      for (let i = 0; i < n; i++) {
        const seg: TranscriptSegment = {
          id: 0,
          start: offsetSec + Number(L.crispasr_session_result_segment_t0(r, i)) / 100,
          end: offsetSec + Number(L.crispasr_session_result_segment_t1(r, i)) / 100,
          text: String(L.crispasr_session_result_segment_text(r, i)).trim(),
        };
        if (words) seg.words = readWords(r, i, offsetSec);
        segs.push(seg);
      }
      return segs;
    } finally {
      L.crispasr_session_result_free(r);
    }
  }

  function readWords(r: Pointer, i: number, offsetSec: number) {
    const out = [];
    const n = L.crispasr_session_result_n_words(r, i);
    for (let w = 0; w < n; w++) {
      const t0 = Number(L.crispasr_session_result_word_t0(r, i, w));
      const t1 = Number(L.crispasr_session_result_word_t1(r, i, w));
      // qwen3 emits words without timings (t0 = t1 = -1); a word list without times is useless to clients.
      if (t0 < 0 || t1 < 0) return undefined;
      out.push({
        word: String(L.crispasr_session_result_word_text(r, i, w)).trim(),
        start: offsetSec + t0 / 100,
        end: offsetSec + t1 / 100,
        probability: L.crispasr_session_result_word_p(r, i, w),
      });
    }
    return out;
  }

  return {
    openSession,
    backend: (s: Pointer) => String(L.crispasr_session_backend(s)),
    setHotwords: (s: Pointer, words: string[]) =>
      L.crispasr_session_set_hotwords(s, cstr(words.join(', ')), 0),
    closeSession: (s: Pointer) => L.crispasr_session_close(s),
    vadSlices,
    detectLanguage,
    transcribe,
    close,
  };
}
