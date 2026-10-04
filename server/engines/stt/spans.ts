/** Span planning + the per-span decode loop of the STT child, kept free of FFI so tests can drive it. */
import type { TranscriptSegment } from '../types';

export const SR = 16_000;
const MIN_SPAN = SR / 10;

type Span = [number, number];

/** VAD spans when there are any; otherwise fixed slices of `maxChunkSec` so one decode never sees the whole file. */
export function planSpans(durationSec: number, vad: Span[] | null, maxChunkSec: number): Span[] {
  if (vad?.length) return vad;
  const out: Span[] = [];
  for (let a = 0; a < durationSec; a += maxChunkSec) out.push([a, Math.min(durationSec, a + maxChunkSec)]);
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
export async function runSpans(a: SpanLoopArgs): Promise<{ text: string; segments: TranscriptSegment[] }> {
  const segments: TranscriptSegment[] = [];
  let text = '';
  for (const [s, e] of a.plan) {
    if (a.isCancelled()) throw new SpanCancelledError(a.id);
    const sub = a.audio.subarray(Math.floor(s * SR), Math.min(a.audio.length, Math.ceil(e * SR)));
    if (sub.length < MIN_SPAN) continue;
    const segs = a.decode(sub, s);
    if (!segs) throw new Error(`crispasr transcribe failed on span ${s.toFixed(2)}-${e.toFixed(2)}s`);
    for (const seg of segs) if (seg.text) segments.push({ ...seg, id: segments.length });
    const piece = segs.map((x) => x.text).filter(Boolean).join(' ');
    if (piece) {
      const delta = text ? ` ${piece}` : piece;
      text += delta;
      a.onDelta(delta);
    }
    await a.yieldNow();
  }
  return { text, segments };
}
