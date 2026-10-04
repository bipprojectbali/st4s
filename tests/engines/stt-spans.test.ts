/** STT child span planning, the cancellable per-span decode loop, and the VAD outcomes of transcribePcm (fake lib). */

import type { Pointer } from 'bun:ffi';
import { describe, expect, test } from 'bun:test';
import { VadFailedError } from '../../server/engines/errors';
import {
  type DecodeLib,
  planSpans,
  runSpans,
  SpanCancelledError,
  SR,
  transcribePcm,
} from '../../server/engines/stt/spans';
import type { TranscriptSegment } from '../../server/engines/types';

const seg = (text: string, start: number): TranscriptSegment[] => [
  { id: 0, start, end: start + 1, text },
];

describe('planSpans', () => {
  test('without VAD (null) slices into spans of at most maxChunkSec covering the whole file', () => {
    const plan = planSpans(70, null, 30);
    expect(plan).toEqual([
      [0, 30],
      [30, 60],
      [60, 70],
    ]);
    for (const [a, b] of plan) expect(b - a).toBeLessThanOrEqual(30);
  });

  test('VAD that heard no speech ([]) plans nothing to decode', () => {
    expect(planSpans(70, [], 30)).toEqual([]);
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

describe('transcribePcm (fake libcrispasr)', () => {
  const audio = new Float32Array(SR * 3);
  const session = 1 as unknown as Pointer;

  function fakeLib(vad: [number, number][] | null) {
    const calls = { vad: 0, lid: 0, hotwords: 0, transcribe: [] as number[] };
    const lib: DecodeLib = {
      vadSlices: () => {
        calls.vad++;
        return vad;
      },
      detectLanguage: () => {
        calls.lid++;
        return 'en';
      },
      setHotwords: () => {
        calls.hotwords++;
        return 0;
      },
      transcribe: (_s, _pcm, _lang, _words, off) => {
        calls.transcribe.push(off);
        return seg('okay.', off);
      },
    };
    return { lib, calls };
  }

  function run(lib: DecodeLib, vadModelPath: string, language = 'auto') {
    const fallbacks: [string, string][] = [];
    const result = transcribePcm({
      lib,
      session,
      cfg: { vadModelPath, lidModelPath: '/lid.gguf', maxChunkSec: 30, threads: 1 },
      job: { id: 1, language, hotwords: [], words: false },
      audio,
      onVadFallback: (kind, reason) => fallbacks.push([kind, reason]),
      onDelta: () => {},
      isCancelled: () => false,
      yieldNow: async () => {},
    });
    return { result, fallbacks };
  }

  test('VAD ran and heard no speech → empty transcript, ASR/LID never run, no fallback warn', async () => {
    const { lib, calls } = fakeLib([]);
    const { result, fallbacks } = run(lib, '/silero.bin');
    expect(await result).toEqual({ text: '', segments: [], duration: 3, language: 'unknown' });
    expect(calls).toEqual({ vad: 1, lid: 0, hotwords: 0, transcribe: [] });
    expect(fallbacks).toEqual([]);
  });

  test('silence keeps an explicit request language', async () => {
    const { result } = run(fakeLib([]).lib, '/silero.bin', 'id');
    expect((await result).language).toBe('id');
  });

  test('VAD failed (null) → job fails with the model basename, ASR never runs on unsliced audio', async () => {
    const { lib, calls } = fakeLib(null);
    const { result, fallbacks } = run(lib, '/models/silero.bin');
    const err = await result.catch((e) => e);
    expect(err).toBeInstanceOf(VadFailedError);
    expect(err.detail).toBe('STT VAD failed on silero.bin (3.0s audio); check STT_VAD_MODEL');
    expect(err.message).not.toContain('silero');
    expect(calls).toEqual({ vad: 1, lid: 0, hotwords: 0, transcribe: [] });
    expect(fallbacks).toEqual([]);
  });

  test('VAD disabled (no model path) → fixed-slice fallback without calling VAD', async () => {
    const { lib, calls } = fakeLib([[0, 1]]);
    const { result, fallbacks } = run(lib, '');
    expect((await result).text).toBe('okay.');
    expect(calls.vad).toBe(0);
    expect(calls.transcribe).toEqual([0]);
    expect(fallbacks.map(([k]) => k)).toEqual(['disabled']);
  });

  test('speech spans are decoded at their offsets', async () => {
    const { lib, calls } = fakeLib([[0.5, 2.5]]);
    const r = await run(lib, '/silero.bin').result;
    expect(calls.transcribe).toEqual([0.5]);
    expect(calls.lid).toBe(1);
    expect(r.language).toBe('en');
  });
});
