/** STT child span planning (fixed-slice fallback without VAD) and the cancellable per-span decode loop. */
import { describe, expect, test } from 'bun:test';
import { planSpans, runSpans, SpanCancelledError, SR } from '../../server/engines/stt/spans';
import type { TranscriptSegment } from '../../server/engines/types';

const seg = (text: string, start: number): TranscriptSegment[] => [
  { id: 0, start, end: start + 1, text },
];

describe('planSpans', () => {
  test('without VAD (null or empty) slices into spans of at most maxChunkSec covering the whole file', () => {
    for (const vad of [null, []]) {
      const plan = planSpans(70, vad, 30);
      expect(plan).toEqual([
        [0, 30],
        [30, 60],
        [60, 70],
      ]);
      for (const [a, b] of plan) expect(b - a).toBeLessThanOrEqual(30);
    }
  });

  test('VAD spans win when present', () => {
    expect(planSpans(70, [[1, 5]], 30)).toEqual([[1, 5]]);
  });
});

describe('runSpans', () => {
  const audio = new Float32Array(SR * 90);

  test('decodes each span at its offset and streams one delta per span', async () => {
    const offsets: number[] = [];
    const deltas: string[] = [];
    const r = await runSpans({
      id: 1,
      audio,
      plan: planSpans(90, null, 30),
      decode: (pcm, off) => {
        expect(pcm.length).toBeLessThanOrEqual(30 * SR);
        offsets.push(off);
        return seg(`s${off}`, off);
      },
      onDelta: (d) => deltas.push(d),
      isCancelled: () => false,
      yieldNow: async () => {},
    });
    expect(offsets).toEqual([0, 30, 60]);
    expect(deltas).toEqual(['s0', ' s30', ' s60']);
    expect(r.text).toBe('s0 s30 s60');
    expect(r.segments.map((s) => s.id)).toEqual([0, 1, 2]);
  });

  test('a cancel that arrives during a span stops before the next one', async () => {
    let cancelled = false;
    let decoded = 0;
    const run = runSpans({
      id: 7,
      audio,
      plan: planSpans(90, null, 30),
      decode: (_pcm, off) => {
        decoded++;
        return seg('x', off);
      },
      onDelta: () => {},
      isCancelled: () => cancelled,
      // the cancel IPC message lands while the child yields after the first span
      yieldNow: async () => {
        cancelled = true;
      },
    });
    const err = await run.catch((e) => e);
    expect(err).toBeInstanceOf(SpanCancelledError);
    expect(err.id).toBe(7);
    expect(decoded).toBe(1);
  });

  test('a decoder failure names the span', async () => {
    const run = runSpans({
      id: 1,
      audio,
      plan: [[30, 60]],
      decode: () => null,
      onDelta: () => {},
      isCancelled: () => false,
      yieldNow: async () => {},
    });
    await expect(run).rejects.toThrow('crispasr transcribe failed on span 30.00-60.00s');
  });
});
