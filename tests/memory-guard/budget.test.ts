/** Cold-load RAM budget: allowed / refused / disabled / loaded skips / concurrent reservations, guard admission, auto-unload audit. */
import { afterAll, afterEach, describe, expect, spyOn, test } from 'bun:test';
import * as auditMod from '../../server/audit';
import type { EngineControl, EngineState } from '../../server/engines/types';
import { logger } from '../../server/logger';
import {
  BUDGET_MESSAGE,
  createBudget,
  MB,
  RESERVE_MAX_MS,
  RESERVE_START_GRACE_MS,
} from '../../server/memory-guard/budget';
import { GUARD_DEFAULTS } from '../../server/memory-guard/config';
import { createMemoryGuard } from '../../server/memory-guard/guard';
import { auditAutoUnload } from '../../server/memory-guard/lifecycle';
import type { EngineStates } from '../../server/memory-guard/machine';

const logWarn = spyOn(logger, 'warn').mockImplementation(() => {});
const logInfo = spyOn(logger, 'info').mockImplementation(() => {});
const auditSpy = spyOn(auditMod, 'audit').mockImplementation(async () => {});
afterEach(() => {
  logWarn.mockClear();
  auditSpy.mockClear();
});
afterAll(() => {
  logWarn.mockRestore();
  logInfo.mockRestore();
  auditSpy.mockRestore();
});

const COLD: EngineStates = { stt: 'unloaded', tts: 'unloaded' };
const free = (mb: number | null) => () => (mb === null ? null : mb * MB);

describe('createBudget', () => {
  test('allows a cold load that fits and refuses one that does not, with MB figures', () => {
    const b = createBudget({ stt: 2600, tts: 600 });
    expect(b.check('stt', 'unloaded', free(2000), 0)).toEqual({ ok: false, neededMb: 2600, availableMb: 2000 });
    expect(b.reservedMb()).toBe(0);
    expect(b.check('stt', 'unloaded', free(4000), 0)).toEqual({ ok: true });
    expect(b.reservedMb()).toBe(2600);
  });

  test('0 disables the check; loaded engines, unknown state and unknown free RAM are never checked', () => {
    const b = createBudget({ stt: 0, tts: 600 });
    expect(b.check('stt', 'unloaded', free(10), 0).ok).toBe(true);
    for (const s of ['ready', 'busy', 'loading'] as EngineState[]) expect(b.check('tts', s, free(10), 0).ok).toBe(true);
    expect(b.check('tts', null, free(10), 0).ok).toBe(true);
    expect(b.check('tts', 'unloaded', free(null), 0).ok).toBe(true);
    expect(b.reservedMb()).toBe(0);
  });

  test('a cold load reserves its budget so a concurrent cold load of the other engine counts both', () => {
    const b = createBudget({ stt: 2600, tts: 600 });
    expect(b.check('stt', 'unloaded', free(3000), 0).ok).toBe(true);
    expect(b.check('tts', 'unloaded', free(3000), 1)).toEqual({ ok: false, neededMb: 600, availableMb: 400 });
    // a second STT request while its load is pending is not charged twice
    expect(b.check('stt', 'unloaded', free(100), 2).ok).toBe(true);
    b.settle({ stt: 'ready', tts: 'unloaded' }, 3);
    expect(b.reservedMb()).toBe(0);
    expect(b.check('tts', 'unloaded', free(3000), 4).ok).toBe(true);
  });

  test('settle releases a failed load, a load that never started, and a hung load', () => {
    const b = createBudget({ stt: 1000, tts: 500 });
    b.check('stt', 'unloaded', free(9000), 0);
    b.check('tts', 'error', free(9000), 0);
    b.settle({ stt: 'loading', tts: 'error' }, 10);
    expect(b.reservedMb()).toBe(1500);
    b.settle({ stt: 'error', tts: 'error' }, 20);
    expect(b.reservedMb()).toBe(500);
    b.settle({ stt: 'error', tts: 'error' }, RESERVE_START_GRACE_MS + 1);
    expect(b.reservedMb()).toBe(0);

    b.check('stt', 'unloaded', free(9000), 0);
    b.settle({ ...COLD, stt: 'loading' }, RESERVE_MAX_MS);
    expect(b.reservedMb()).toBe(1000);
    b.settle({ ...COLD, stt: 'loading' }, RESERVE_MAX_MS + 1);
    expect(b.reservedMb()).toBe(0);
  });

  test('message states needed vs available RAM in id-ID format', () => {
    expect(BUDGET_MESSAGE({ engine: 'stt', neededMb: 2600, availableMb: 1234, retryAfterSec: 30 })).toBe(
      'RAM server tidak cukup untuk memuat engine STT: butuh 2.600 MB, tersedia 1.234 MB. Tutup aplikasi lain yang berat atau coba lagi dalam 30 detik.',
    );
  });
});

function engine(state: EngineState): EngineControl & { state: EngineState } {
  const e = {
    state,
    status: () => ({ kind: 'stt', state: e.state }) as ReturnType<EngineControl['status']>,
    warmup: async () => {},
    unload: async () => {},
  };
  return e;
}

function guardWith(opts: { freeMb: number; freePct?: number | null; stt?: EngineState; tts?: EngineState }) {
  const stt = engine(opts.stt ?? 'unloaded');
  const tts = engine(opts.tts ?? 'unloaded');
  const env = { freeMb: opts.freeMb, freePct: opts.freePct === undefined ? 50 : opts.freePct };
  const guard = createMemoryGuard({
    cfg: GUARD_DEFAULTS,
    read: () => ({ freePct: env.freePct, pressure: 1, freeBytes: env.freeMb * MB }),
    engines: () => ({ stt, tts }),
    audit: () => {},
    now: () => 1_000_000,
    schedule: () => () => {},
  });
  return { guard, env, stt, tts };
}

describe('guard admission with budget', () => {
  test('refuses a cold STT load below budget, records lastRefusal and logs metrics only', () => {
    const { guard } = guardWith({ freeMb: 1800 });
    expect(guard.admit('stt')).toEqual({
      ok: false,
      reason: 'budget',
      retryAfterSec: 30,
      engine: 'stt',
      neededMb: 2600,
      availableMb: 1800,
    });
    expect(guard.status()).toMatchObject({
      budgetMb: { stt: 2600, tts: 600 },
      reservedMb: 0,
      lastRefusal: { engine: 'stt', neededMb: 2600, availableMb: 1800, at: expect.any(String) },
    });
    expect(logWarn).toHaveBeenCalledWith(expect.objectContaining({ engine: 'stt', action: 'refuse-load' }), expect.any(String));
    expect(guard.admit()).toEqual({ ok: true });
  });

  test('admits a loaded engine at any free RAM, and reserves then releases a cold load', async () => {
    const { guard, stt } = guardWith({ freeMb: 3000, tts: 'ready' });
    expect(guard.admit('tts')).toEqual({ ok: true });
    expect(guard.admit('stt')).toEqual({ ok: true });
    expect(guard.status().reservedMb).toBe(2600);
    stt.state = 'ready';
    await guard.tick();
    expect(guard.status().reservedMb).toBe(0);
  });

  test('two cold loads racing: the second is refused while the first holds its reservation', () => {
    const { guard } = guardWith({ freeMb: 3000 });
    expect(guard.admit('stt').ok).toBe(true);
    expect(guard.admit('tts')).toMatchObject({ ok: false, reason: 'budget', engine: 'tts', availableMb: 400 });
  });

  test('skips the budget when the reading is the unreliable fallback (freePct null)', () => {
    const { guard } = guardWith({ freeMb: 10, freePct: null });
    expect(guard.admit('stt')).toEqual({ ok: true });
  });
});

describe('auto-unload audit', () => {
  test('uses engine.auto_unload with engine, reason, level, freePct, ms and ok in meta', () => {
    auditAutoUnload({ engine: 'stt', reason: 'emergency', level: 'emergency', freePct: 9, ms: 120, ok: true });
    expect(auditSpy).toHaveBeenCalledTimes(1);
    const entry = auditSpy.mock.calls[0][0];
    expect(entry).toMatchObject({
      actor: null,
      action: 'engine.auto_unload',
      targetType: 'engine',
      targetId: 'stt',
      meta: { by: 'memory-guard', engine: 'stt', reason: 'emergency', level: 'emergency', freePct: 9, ms: 120, ok: true },
    });
    expect(entry.action).toBe(auditMod.AUDIT_ACTIONS.ENGINE_AUTO_UNLOAD);
  });
});
