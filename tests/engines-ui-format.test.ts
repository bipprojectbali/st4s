/** Engine/playground formatters: small uploads must not collapse to "0 MB". */
import { describe, expect, test } from 'bun:test';
import {
  depsFor,
  type EngineOverview,
  type EngineStatus,
  enginesRefreshMs,
  formatBytes,
  REFRESH_FAST_MS,
  REFRESH_SLOW_MS,
} from '../app/lib/engines-api';

describe('formatBytes', () => {
  test('picks a unit that keeps small sizes visible', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(11)).toBe('11 B');
    expect(formatBytes(12_800)).toBe('12,5 KB');
    expect(formatBytes(340 * 1024 ** 2)).toBe('340 MB');
    expect(formatBytes(1.25 * 1024 ** 3)).toBe('1,3 GB');
  });
});

describe('depsFor', () => {
  const deps = [
    'CRISPASR_LIB',
    'STT_MODEL',
    'STT_VAD_MODEL',
    'STT_LID_MODEL',
    'TTS_MODEL_DIR',
    'FFMPEG_PATH',
  ].map((name) => ({ name, ok: true, detail: '/x' }));
  test('splits engine deps and shares ffmpeg', () => {
    expect(depsFor('stt', deps).map((d) => d.name)).toEqual([
      'CRISPASR_LIB',
      'STT_MODEL',
      'STT_VAD_MODEL',
      'STT_LID_MODEL',
      'FFMPEG_PATH',
    ]);
    expect(depsFor('tts', deps).map((d) => d.name)).toEqual(['TTS_MODEL_DIR', 'FFMPEG_PATH']);
  });
});

describe('enginesRefreshMs', () => {
  const engine = (over: Partial<EngineStatus> = {}) =>
    ({ kind: 'stt', state: 'ready', queued: 0, ...over }) as EngineStatus;
  const overview = (stt: EngineStatus | null, guard: Partial<EngineOverview['memoryGuard']> = {}) =>
    ({
      stt,
      tts: engine({ kind: 'tts', state: 'unloaded' }),
      memoryGuard: { shedding: false, level: 'normal', reservedMb: 0, ...guard },
    }) as EngineOverview;

  test('polls slowly when every engine is idle', () => {
    expect(enginesRefreshMs(overview(engine()))).toBe(REFRESH_SLOW_MS);
    expect(enginesRefreshMs(overview(null))).toBe(REFRESH_SLOW_MS);
    expect(enginesRefreshMs(overview(engine({ state: 'error' })))).toBe(REFRESH_SLOW_MS);
  });

  test('polls fast while an engine loads, works, or has a queue', () => {
    expect(enginesRefreshMs(overview(engine({ state: 'loading' })))).toBe(REFRESH_FAST_MS);
    expect(enginesRefreshMs(overview(engine({ state: 'busy' })))).toBe(REFRESH_FAST_MS);
    expect(enginesRefreshMs(overview(engine({ queued: 1 })))).toBe(REFRESH_FAST_MS);
  });

  test('polls fast while the memory guard is above normal or reserving a cold load', () => {
    expect(enginesRefreshMs(overview(engine(), { level: 'warn' }))).toBe(REFRESH_FAST_MS);
    expect(enginesRefreshMs(overview(engine(), { shedding: true }))).toBe(REFRESH_FAST_MS);
    expect(enginesRefreshMs(overview(engine(), { reservedMb: 1600 }))).toBe(REFRESH_FAST_MS);
  });

  test('polls fast with no data yet or a warmup/unload in flight', () => {
    expect(enginesRefreshMs(undefined)).toBe(REFRESH_FAST_MS);
    expect(enginesRefreshMs(overview(engine()), true)).toBe(REFRESH_FAST_MS);
    expect(REFRESH_FAST_MS).toBeLessThan(REFRESH_SLOW_MS);
  });
});
