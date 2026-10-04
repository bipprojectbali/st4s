/** Memory-guard runner with a fake clock, scheduler, reader and engines: adaptive delays, unloads, audit, admission. */
import { afterAll, afterEach, describe, expect, spyOn, test } from 'bun:test';
import type { EngineControl, EngineState } from '../../server/engines/types';
import { logger } from '../../server/logger';
import { GUARD_DEFAULTS } from '../../server/memory-guard/config';
import { createMemoryGuard, type GuardAuditEntry, WAKE_GRACE_MS } from '../../server/memory-guard/guard';
import { FAST_MS, SLOW_MS } from '../../server/memory-guard/machine';

const logError = spyOn(logger, 'error').mockImplementation(() => {});
const logWarn = spyOn(logger, 'warn').mockImplementation(() => {});
const logInfo = spyOn(logger, 'info').mockImplementation(() => {});
afterEach(() => {
  logError.mockClear();
  logWarn.mockClear();
  logInfo.mockClear();
});
afterAll(() => {
  logError.mockRestore();
  logWarn.mockRestore();
  logInfo.mockRestore();
});

type Fake = EngineControl & { state: EngineState; unloads: number };

function fakeEngine(state: EngineState, unload: (e: Fake) => Promise<void> = async (e) => void (e.state = 'unloaded')): Fake {
  const e: Fake = {
    state,
    unloads: 0,
    status: () => ({ kind: 'stt', state: e.state }) as ReturnType<EngineControl['status']>,
    warmup: async () => {},
    unload: () => {
      e.unloads++;
      return unload(e);
    },
  };
  return e;
}

function harness(opts: { stt?: Fake; tts?: Fake; freePct?: number; unloadTimeoutMs?: number } = {}) {
  let clock = 1_000_000;
  const env = { freePct: opts.freePct ?? 70, pressure: 1 as number | null };
  const delays: number[] = [];
  let pending: (() => void) | null = null;
  const audits: GuardAuditEntry[] = [];
  const guard = createMemoryGuard({
    cfg: GUARD_DEFAULTS,
    read: () => ({ freePct: env.freePct, pressure: env.pressure }),
    engines: () => ({ stt: opts.stt, tts: opts.tts }),
    audit: (a) => audits.push(a),
    now: () => clock,
    schedule: (fn, ms) => {
      delays.push(ms);
      pending = fn;
      return () => {
        if (pending === fn) pending = null;
      };
    },
    unloadTimeoutMs: opts.unloadTimeoutMs,
  });
  return {
    guard,
    env,
    delays,
    audits,
    advance: (ms: number) => void (clock += ms),
    armed: () => pending !== null,
  };
}

describe('adaptive interval', () => {
  test('stays idle with no engine loaded; wake() polls fast for the grace period, then idles', async () => {
    const h = harness({ stt: fakeEngine('unloaded') });
    h.guard.start();
    await h.guard.tick();
    expect(h.armed()).toBe(false);
    expect(h.guard.status().active).toBe(false);

    h.guard.wake();
    await Bun.sleep(0);
    expect(h.delays.at(-1)).toBe(FAST_MS);
    h.advance(WAKE_GRACE_MS);
    await h.guard.tick();
    expect(h.armed()).toBe(false);
  });

  test('fast while busy, slow once loaded and idle', async () => {
    const stt = fakeEngine('busy');
    const h = harness({ stt });
    h.guard.start();
    await Bun.sleep(0);
    expect(h.delays).toEqual([FAST_MS]);
    stt.state = 'ready';
    await h.guard.tick();
    expect(h.delays.at(-1)).toBe(SLOW_MS);
  });

  test('stop() disarms the timer and later ticks do not re-arm', async () => {
    const h = harness({ stt: fakeEngine('ready') });
    h.guard.start();
    await Bun.sleep(0);
    expect(h.armed()).toBe(true);
    h.guard.stop();
    expect(h.armed()).toBe(false);
    await h.guard.tick();
    expect(h.armed()).toBe(false);
  });
});

describe('actions', () => {
  test('warn sheds new work with Retry-After and logs one warning', async () => {
    const h = harness({ stt: fakeEngine('ready'), freePct: 25 });
    h.guard.start();
    await Bun.sleep(0);
    expect(h.guard.status()).toMatchObject({ level: 'warn', shedding: true, freePct: 25 });
    expect(h.guard.admit()).toEqual({ ok: false, reason: 'pressure', retryAfterSec: 30 });
    expect(h.guard.admit('stt')).toMatchObject({ ok: false, reason: 'pressure' });
    expect(logWarn).toHaveBeenCalled();
    expect(h.audits).toEqual([]);
  });

  test('critical unloads the idle engine, audits it and records lastAction', async () => {
    const stt = fakeEngine('busy');
    const tts = fakeEngine('ready');
    const h = harness({ stt, tts, freePct: 18 });
    await h.guard.tick();
    expect(tts.unloads).toBe(1);
    expect(stt.unloads).toBe(0);
    expect(h.audits).toEqual([
      { engine: 'tts', reason: 'idle', level: 'critical', freePct: 18, ms: expect.any(Number), ok: true },
    ]);
    expect(h.guard.status().lastAction).toMatchObject({ kind: 'unload', engine: 'tts', reason: 'idle', ok: true });
  });

  test('emergency unloads STT before TTS', async () => {
    const order: string[] = [];
    const stt = fakeEngine('busy', async (e) => void (order.push('stt'), (e.state = 'unloaded')));
    const tts = fakeEngine('ready', async (e) => void (order.push('tts'), (e.state = 'unloaded')));
    const h = harness({ stt, tts, freePct: 8 });
    await h.guard.tick();
    expect(order).toEqual(['stt', 'tts']);
    expect(h.audits.map((a) => a.reason)).toEqual(['emergency', 'emergency']);
  });

  test('a hung unload is reported after the timeout and the guard moves on', async () => {
    const stt = fakeEngine('busy', () => new Promise(() => {}));
    const tts = fakeEngine('ready');
    const h = harness({ stt, tts, freePct: 8, unloadTimeoutMs: 20 });
    await h.guard.tick();
    expect(h.audits.map((a) => [a.engine, a.ok])).toEqual([
      ['stt', false],
      ['tts', true],
    ]);
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ engine: 'stt', timeoutMs: 20 }), expect.any(String));
  });

  test('never reloads an engine on recovery', async () => {
    const tts = fakeEngine('ready');
    const warmup = spyOn(tts, 'warmup');
    const h = harness({ tts, freePct: 18 });
    await h.guard.tick();
    h.env.freePct = 80;
    h.advance(60_000);
    await h.guard.tick();
    h.advance(60_000);
    await h.guard.tick();
    expect(h.guard.status().shedding).toBe(false);
    expect(warmup).not.toHaveBeenCalled();
    warmup.mockRestore();
  });
});
