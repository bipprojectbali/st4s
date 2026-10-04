/** Pure memory-guard state machine: levels, shedding hysteresis, cooldown, unload ordering and poll delay. */
import { describe, expect, test } from 'bun:test';
import { GUARD_DEFAULTS, loadGuardConfig } from '../../server/memory-guard/config';
import {
  classify,
  type EngineStates,
  FAST_MS,
  INITIAL_STATE,
  type MachineState,
  nextDelay,
  retryAfterSec,
  SLOW_MS,
  step,
} from '../../server/memory-guard/machine';

const cfg = GUARD_DEFAULTS; // warn 30, critical 20, emergency 12, recover 40 for 30 s, cooldown 3 s
const r = (freePct: number | null, pressure: number | null = 1) => ({ freePct, pressure });
const NONE: EngineStates = { stt: null, tts: null };
const IDLE: EngineStates = { stt: 'ready', tts: 'ready' };

describe('classify', () => {
  test('thresholds and kernel pressure', () => {
    expect(classify(r(50), cfg)).toBe('normal');
    expect(classify(r(30), cfg)).toBe('normal');
    expect(classify(r(29.9), cfg)).toBe('warn');
    expect(classify(r(19), cfg)).toBe('critical');
    expect(classify(r(11), cfg)).toBe('emergency');
    expect(classify(r(70, 4), cfg)).toBe('critical');
    expect(classify(r(70, 2), cfg)).toBe('normal');
    expect(classify(r(null, 4), cfg)).toBe('critical');
    expect(classify(r(null, null), cfg)).toBe('normal');
  });
});

describe('step: shedding hysteresis', () => {
  test('sheds from warn until free ≥ RECOVER for RECOVER_SEC', () => {
    let s = step(INITIAL_STATE, r(25), NONE, 0, cfg).state;
    expect(s).toMatchObject({ level: 'warn', shedding: true });
    s = step(s, r(35), NONE, 1000, cfg).state; // normal level but below RECOVER
    expect(s).toMatchObject({ level: 'normal', shedding: true, recoveredSince: null });
    s = step(s, r(45), NONE, 2000, cfg).state;
    expect(s.recoveredSince).toBe(2000);
    expect(retryAfterSec(s, 12_000, cfg)).toBe(20);
    s = step(s, r(39), NONE, 10_000, cfg).state; // dipped: window restarts
    expect(s.recoveredSince).toBeNull();
    s = step(s, r(45), NONE, 11_000, cfg).state;
    s = step(s, r(45), NONE, 40_999, cfg).state;
    expect(s.shedding).toBe(true);
    s = step(s, r(45), NONE, 41_000, cfg).state;
    expect(s).toMatchObject({ shedding: false, recoveredSince: null });
  });

  test('retry-after is the full window before recovery starts, never below 1', () => {
    const s = step(INITIAL_STATE, r(25), NONE, 0, cfg).state;
    expect(retryAfterSec(s, 0, cfg)).toBe(30);
    expect(retryAfterSec({ ...s, recoveredSince: 0 }, 60_000, cfg)).toBe(1);
  });
});

describe('step: unload decisions', () => {
  test('warn never unloads', () => {
    expect(step(INITIAL_STATE, r(25), IDLE, 0, cfg).unloads).toEqual([]);
  });

  test('critical unloads idle engines first, the busy one only on a later critical tick', () => {
    const engines: EngineStates = { stt: 'busy', tts: 'ready' };
    const a = step(INITIAL_STATE, r(18), engines, 0, cfg);
    expect(a.unloads).toEqual([{ engine: 'tts', reason: 'idle' }]);
    const b = step(a.state, r(18), { stt: 'busy', tts: 'unloaded' }, 1000, cfg);
    expect(b.unloads).toEqual([]); // cooldown
    const c = step(b.state, r(18), { stt: 'busy', tts: 'unloaded' }, 3000, cfg);
    expect(c.unloads).toEqual([{ engine: 'stt', reason: 'busy' }]);
  });

  test('a first critical tick with only busy engines waits one tick', () => {
    const busy: EngineStates = { stt: 'busy', tts: 'loading' };
    const a = step(INITIAL_STATE, r(18), busy, 0, cfg);
    expect(a.unloads).toEqual([]);
    expect(step(a.state, r(18), busy, 500, cfg).unloads).toEqual([
      { engine: 'stt', reason: 'busy' },
    ]);
  });

  test('emergency unloads STT then TTS at once, ignoring cooldown', () => {
    const prev: MachineState = { ...INITIAL_STATE, lastActionAt: 0 };
    const { unloads, state } = step(prev, r(10), { stt: 'busy', tts: 'ready' }, 100, cfg);
    expect(unloads).toEqual([
      { engine: 'stt', reason: 'emergency' },
      { engine: 'tts', reason: 'emergency' },
    ]);
    expect(state.lastActionAt).toBe(100);
  });

  test('unloaded, errored and unregistered engines are left alone', () => {
    expect(step(INITIAL_STATE, r(10), { stt: 'unloaded', tts: 'error' }, 0, cfg).unloads).toEqual(
      [],
    );
    expect(step(INITIAL_STATE, r(10), NONE, 0, cfg).unloads).toEqual([]);
  });

  test('a normal tick resets the critical streak', () => {
    const a = step(INITIAL_STATE, r(18), NONE, 0, cfg).state;
    expect(a.severeTicks).toBe(1);
    expect(step(a, r(50), NONE, 500, cfg).state.severeTicks).toBe(0);
  });
});

describe('nextDelay', () => {
  const calm = INITIAL_STATE;
  test('idle (no timer) when nothing is loaded and RAM is fine', () => {
    expect(nextDelay(calm, NONE, 0, 0)).toBeNull();
    expect(nextDelay(calm, { stt: 'unloaded', tts: 'error' }, 0, 0)).toBeNull();
  });
  test('slow while an engine sits loaded or shedding waits to recover', () => {
    expect(nextDelay(calm, { stt: 'ready', tts: 'unloaded' }, 0, 0)).toBe(SLOW_MS);
    expect(nextDelay({ ...calm, shedding: true }, NONE, 0, 0)).toBe(SLOW_MS);
  });
  test('fast while busy/loading, under pressure, or inside the wake grace', () => {
    expect(nextDelay(calm, { stt: 'busy', tts: null }, 0, 0)).toBe(FAST_MS);
    expect(nextDelay(calm, { stt: null, tts: 'loading' }, 0, 0)).toBe(FAST_MS);
    expect(nextDelay({ ...calm, level: 'warn' }, NONE, 0, 0)).toBe(FAST_MS);
    expect(nextDelay(calm, NONE, 10, 11)).toBe(FAST_MS);
  });
});

describe('loadGuardConfig', () => {
  test('defaults match the documented values', () => {
    expect(loadGuardConfig({})).toEqual({
      enabled: true,
      warnPct: 30,
      criticalPct: 20,
      emergencyPct: 12,
      recoverPct: 40,
      recoverSec: 30,
      cooldownSec: 3,
      budgetMb: { stt: 2600, tts: 600 },
    });
    expect(loadGuardConfig({ MEM_GUARD_ENABLED: 'false' }).enabled).toBe(false);
  });
  test('out-of-order thresholds fail with an actionable message', () => {
    expect(() => loadGuardConfig({ MEM_GUARD_CRITICAL_PCT: '35' })).toThrow(
      'EMERGENCY < CRITICAL < WARN < RECOVER',
    );
    expect(() => loadGuardConfig({ MEM_GUARD_RECOVER_PCT: '30' })).toThrow('Perbaiki .env');
  });
  test('malformed values are rejected', () => {
    expect(() => loadGuardConfig({ MEM_GUARD_WARN_PCT: 'abc' })).toThrow('MEM_GUARD_WARN_PCT');
    expect(() => loadGuardConfig({ MEM_GUARD_EMERGENCY_PCT: '0' })).toThrow('1–99');
    expect(() => loadGuardConfig({ MEM_GUARD_RECOVER_SEC: '-1' })).toThrow('MEM_GUARD_RECOVER_SEC');
  });
  test('MEM_BUDGET_*_MB: integer MB ≥ 0, 0 disables, anything else fails', () => {
    expect(loadGuardConfig({ MEM_BUDGET_STT_MB: '3000', MEM_BUDGET_TTS_MB: '0' }).budgetMb).toEqual(
      { stt: 3000, tts: 0 },
    );
    expect(() => loadGuardConfig({ MEM_BUDGET_STT_MB: '-1' })).toThrow('MEM_BUDGET_STT_MB');
    expect(() => loadGuardConfig({ MEM_BUDGET_TTS_MB: '1.5' })).toThrow('bilangan bulat MB');
    expect(() => loadGuardConfig({ MEM_BUDGET_TTS_MB: 'banyak' })).toThrow('MEM_BUDGET_TTS_MB');
  });
});
