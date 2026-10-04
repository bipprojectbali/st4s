/** STT load-time self-test: known clip → transcript overlap, VAD spans, and silence → empty text, run in the loaded child. */
import { parseWav } from '../../audio/decode-wav';
import type { logger } from '../../logger';
import type { FromChild, ToChild } from './protocol';
import fixturePath from './selftest.wav' with { type: 'file' };
import { selfTestTimeoutReason, selfTestTimeoutSec } from './selftest-env';

/** What selftest.wav says (JFK inaugural, 2.7 s, 16 kHz mono PCM16). */
export const SELFTEST_TEXT = 'ask what you can do for your country';
/** ≥5 of 8 words: tolerates an inflection or an edge word, rejects a broken model (garbage or wrong-language decode ≈ 0). */
export const SELFTEST_MIN_OVERLAP = 0.6;
const SR = 16_000;
const VAD_OPTS = { threshold: 0.5, minSilenceMs: 300 };
const RELOAD = 'lalu muat ulang engine di /dev/engines';

type Span = [number, number];
type Log = typeof logger;

/** Lowercased words with punctuation dropped. */
export const normaliseWords = (s: string) =>
  s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** Multiset word matches over the longer side, so missing words and extra garbage both lower the score (0–1). */
export function wordOverlap(expected: string, got: string): number {
  const want = normaliseWords(expected);
  const have = normaliseWords(got);
  const left = new Map<string, number>();
  for (const w of want) left.set(w, (left.get(w) ?? 0) + 1);
  let hit = 0;
  for (const w of have) {
    const n = left.get(w) ?? 0;
    if (n > 0) {
      hit++;
      left.set(w, n - 1);
    }
  }
  return hit / Math.max(want.length, have.length, 1);
}

/** What the self-test needs from the loaded child. */
export type SttProbe = {
  transcribe(audio: Float32Array, language: string): Promise<string>;
  vad(audio: Float32Array): Promise<Span[]>;
};

/** Probe requests use negative ids so they never collide with jobs or the VAD bridge. */
export function createSttProbe(send: (m: ToChild) => boolean) {
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
  let nextId = -1;
  const ask = <T>(build: (id: number) => ToChild) =>
    new Promise<T>((resolve, reject) => {
      const id = nextId--;
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      if (send(build(id))) return;
      pending.delete(id);
      reject(new Error(`STT child gone before self-test request ${id}`));
    });
  return {
    transcribe: (audio: Float32Array, language: string) =>
      ask<string>((id) => ({ t: 'transcribe', id, audio, language, hotwords: [], words: false })),
    vad: (audio: Float32Array) => ask<Span[]>((id) => ({ t: 'vad', id, audio, ...VAD_OPTS })),
    /** True when `m` answers a probe (consumed); false for job and VAD-bridge traffic. */
    take(m: FromChild): boolean {
      if (!('id' in m) || m.id >= 0) return false;
      const p = pending.get(m.id);
      if (!p || m.t === 'delta') return true;
      pending.delete(m.id);
      if (m.t === 'result') p.resolve(m.result.text);
      else if (m.t === 'vad_result') p.resolve(m.spans);
      else if (m.t === 'cancelled') p.reject(new Error(`self-test request ${m.id} cancelled`));
      else p.reject(new Error(m.message));
      return true;
    },
    failAll(err: Error): void {
      for (const p of pending.values()) p.reject(err);
      pending.clear();
    },
  };
}

async function loadClip(): Promise<Float32Array> {
  const wav = parseWav(new Uint8Array(await Bun.file(fixturePath).arrayBuffer()));
  if (wav.sampleRate !== SR)
    throw new Error(`selftest.wav is ${wav.sampleRate} Hz, expected ${SR}`);
  return wav.samples;
}

type Check = { name: string; run(): Promise<{ pass: boolean; facts: object; reason: string }> };

/** Whole self-test deadline: measured ~2 s warm, but the first transcribe also loads the encoder GGUF (+1.4 GB) on a possibly swapping 8 GB host. */
export const STT_SELFTEST_TIMEOUT_SEC = 60;

/** Runs the checks in order (cheapest first) within the deadline; null = all passed, else an Indonesian reason naming the failed check. */
export async function runSttSelfTest(
  probe: SttProbe,
  opts: { vad: boolean; log: Log },
): Promise<string | null> {
  const sec = selfTestTimeoutSec(STT_SELFTEST_TIMEOUT_SEC);
  let timer: ReturnType<typeof setTimeout> | undefined;
  // On timeout the engine refuses and kills the child; its exit rejects the pending probe, ending runChecks.
  const timeout = new Promise<string>((resolve) => {
    timer = setTimeout(() => {
      opts.log.error({ check: 'timeout', ms: sec * 1000, pass: false }, 'stt self-test check');
      resolve(selfTestTimeoutReason('STT', sec));
    }, sec * 1000);
    timer.unref?.();
  });
  try {
    return await Promise.race([runChecks(probe, opts), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function runChecks(
  probe: SttProbe,
  opts: { vad: boolean; log: Log },
): Promise<string | null> {
  let clip: Float32Array;
  try {
    clip = await loadClip();
  } catch (e) {
    opts.log.error({ check: 'fixture', err: (e as Error).message }, 'stt self-test check');
    return `Self-test STT gagal: file contoh suara (selftest.wav) tidak terbaca — build/instalasi rusak, pasang ulang aplikasi.`;
  }
  const checks: Check[] = [];
  if (opts.vad)
    checks.push(
      {
        name: 'vad_speech',
        run: async () => {
          const spans = await probe.vad(clip);
          return {
            pass: spans.length > 0,
            facts: { spans: spans.length },
            reason: `VAD tidak mendeteksi suara pada contoh ucapan — periksa file model VAD (STT_VAD_MODEL), ${RELOAD}.`,
          };
        },
      },
      {
        name: 'silence_empty',
        run: async () => {
          const text = await probe.transcribe(new Float32Array(SR), 'en');
          return {
            pass: text.trim() === '',
            facts: { chars: text.length },
            reason: `hening 1 detik ditranskripsi sebagai teks — periksa model VAD (STT_VAD_MODEL) dan library crispasr, ${RELOAD}.`,
          };
        },
      },
    );
  else
    opts.log.warn(
      { checks: ['vad_speech', 'silence_empty'] },
      'stt self-test: VAD disabled, checks skipped',
    );
  checks.push({
    name: 'clip_overlap',
    run: async () => {
      const overlap = wordOverlap(SELFTEST_TEXT, await probe.transcribe(clip, 'en'));
      const pct = Math.round(overlap * 100);
      return {
        pass: overlap >= SELFTEST_MIN_OVERLAP,
        facts: { overlap: Number(overlap.toFixed(2)) },
        reason: `transkrip contoh ucapan tidak cocok (kecocokan ${pct}% < ${SELFTEST_MIN_OVERLAP * 100}%) — periksa file model STT (STT_MODEL), library crispasr dan STT_GPU, ${RELOAD}.`,
      };
    },
  });
  for (const c of checks) {
    const t0 = performance.now();
    let r: Awaited<ReturnType<Check['run']>>;
    try {
      r = await c.run();
    } catch (e) {
      const err = (e as Error).message;
      opts.log.error(
        { check: c.name, ms: Math.round(performance.now() - t0), pass: false, err },
        'stt self-test check',
      );
      return `Self-test STT gagal (${c.name}): engine error saat memproses contoh suara — lihat log server, ${RELOAD}.`;
    }
    opts.log.info(
      { check: c.name, ms: Math.round(performance.now() - t0), pass: r.pass, ...r.facts },
      'stt self-test check',
    );
    if (!r.pass) return `Self-test STT gagal (${c.name}): ${r.reason}`;
  }
  return null;
}
