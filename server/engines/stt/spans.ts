/** The STT child's decode path (VAD → spans → decode loop), kept free of FFI so tests can drive it with a fake lib. */
import type { Pointer } from 'bun:ffi';
import type { TranscribeResult, TranscriptSegment } from '../types';
import type { SttConfig } from './config';
import type { openCrispasr } from './ffi';
import type { TranscribeMsg } from './protocol';

export const SR = 16_000;
const MIN_SPAN = SR / 10;

type Span = [number, number];

/** VAD spans as-is ([] = no speech, nothing to decode); VAD unavailable (null) → fixed slices of `maxChunkSec`. */
export function planSpans(durationSec: number, vad: Span[] | null, maxChunkSec: number): Span[] {
  if (vad) return vad;
  const out: Span[] = [];
  for (let a = 0; a < durationSec; a += maxChunkSec)
    out.push([a, Math.min(durationSec, a + maxChunkSec)]);
  return out;
}

/** Thrown by runSpans when the job was cancelled between spans. */
export class SpanCancelledError extends Error {
  constructor(readonly id: number) {
    super(`STT job ${id} cancelled`);
  }
}

export type SpanLoopArgs = {
  id: number;
  audio: Float32Array;
  plan: Span[];
  /** One blocking decode of `pcm` starting at `offsetSec`; null = decoder failure. */
  decode(pcm: Float32Array, offsetSec: number): TranscriptSegment[] | null;
  onDelta(text: string): void;
  isCancelled(): boolean;
  /** Yield to the event loop so IPC (deltas out, cancel in) moves between blocking decodes. */
  yieldNow(): Promise<void>;
};

/** Decode `plan` span by span; checks cancellation before each span (the span in flight cannot be interrupted). */
export async function runSpans(
  a: SpanLoopArgs,
): Promise<{ text: string; segments: TranscriptSegment[] }> {
  const segments: TranscriptSegment[] = [];
  let text = '';
  for (const [s, e] of a.plan) {
    if (a.isCancelled()) throw new SpanCancelledError(a.id);
    const sub = a.audio.subarray(Math.floor(s * SR), Math.min(a.audio.length, Math.ceil(e * SR)));
    if (sub.length < MIN_SPAN) continue;
    const segs = a.decode(sub, s);
    if (!segs)
      throw new Error(`crispasr transcribe failed on span ${s.toFixed(2)}-${e.toFixed(2)}s`);
    for (const seg of segs) if (seg.text) segments.push({ ...seg, id: segments.length });
    const piece = segs
      .map((x) => x.text)
      .filter(Boolean)
      .join(' ');
    if (piece) {
      const delta = text ? ` ${piece}` : piece;
      text += delta;
      a.onDelta(delta);
    }
    await a.yieldNow();
  }
  return { text, segments };
}

/** The libcrispasr calls one transcription makes. */
export type DecodeLib = Pick<
  ReturnType<typeof openCrispasr>,
  'vadSlices' | 'detectLanguage' | 'setHotwords' | 'transcribe'
>;

export type TranscribeArgs = Pick<SpanLoopArgs, 'onDelta' | 'isCancelled' | 'yieldNow'> & {
  lib: DecodeLib;
  session: Pointer;
  cfg: Pick<SttConfig, 'vadModelPath' | 'lidModelPath' | 'maxChunkSec' | 'threads'>;
  job: Pick<TranscribeMsg, 'id' | 'language' | 'hotwords' | 'words'>;
  audio: Float32Array;
  /** VAD disabled or failed for this job (the caller decides how often to warn). */
  onVadFallback(kind: 'disabled' | 'failed', reason: string): void;
};

/** One job: Silero hears no speech → empty result without ASR; VAD unavailable → fixed slices; else decode the speech spans. */
export async function transcribePcm(a: TranscribeArgs): Promise<TranscribeResult> {
  const { lib, cfg, job, audio } = a;
  const duration = audio.length / SR;
  const vad = cfg.vadModelPath
    ? lib.vadSlices(cfg.vadModelPath, audio, cfg.maxChunkSec, cfg.threads)
    : null;
  const fallback = `falling back to fixed ${cfg.maxChunkSec}s slices`;
  if (!vad && cfg.vadModelPath)
    a.onVadFallback(
      'failed',
      `VAD failed on ${cfg.vadModelPath} (${duration.toFixed(1)}s audio); ${fallback}`,
    );
  else if (!vad) a.onVadFallback('disabled', `VAD disabled (STT_VAD_MODEL empty); ${fallback}`);
  // Decoding pure silence makes Qwen3-ASR hallucinate ("okay."); OpenAI answers silence with empty text.
  if (vad?.length === 0)
    return {
      text: '',
      segments: [],
      duration,
      language: job.language === 'auto' ? 'unknown' : job.language,
    };
  const lang =
    job.language === 'auto'
      ? cfg.lidModelPath
        ? lib.detectLanguage(cfg.lidModelPath, audio, cfg.threads)
        : null
      : job.language;
  lib.setHotwords(a.session, job.hotwords);
  // qwen3 fires token callbacks only after a span's full decode (crispasr_c_api.cpp _fire_token_callbacks),
  // so streaming = one delta per span (VAD speech merged up to STT_MAX_CHUNK_SEC), emitted between FFI calls.
  const { text, segments } = await runSpans({
    id: job.id,
    audio,
    plan: planSpans(duration, vad, cfg.maxChunkSec),
    decode: (pcm, offset) => lib.transcribe(a.session, pcm, lang, job.words, offset),
    onDelta: a.onDelta,
    isCancelled: a.isCancelled,
    yieldNow: a.yieldNow,
  });
  return { text, language: lang ?? 'unknown', duration, segments };
}
