/** Pure memory-guard state machine: level, shedding hysteresis, unload decisions and poll interval. */
import type { EngineState } from '../engines/types';
import type { GuardConfig } from './config';

export type GuardLevel = 'normal' | 'warn' | 'critical' | 'emergency';
export type GuardEngine = 'stt' | 'tts';
/** null = engine not registered (or its unload is still pending). */
export type EngineStates = Record<GuardEngine, EngineState | null>;
/** freeBytes feeds the cold-load budget; it is ignored when freePct is null (unreliable fallback figure). */
export type Reading = { freePct: number | null; pressure: number | null; freeBytes?: number };
export type UnloadReason = 'idle' | 'busy' | 'emergency';
export type Unload = { engine: GuardEngine; reason: UnloadReason };

export type MachineState = {
  level: GuardLevel;
  freePct: number | null;
  shedding: boolean;
  /** When free % first reached RECOVER during the current shedding period. */
  recoveredSince: number | null;
  /** Consecutive ticks at critical or worse. */
  severeTicks: number;
  lastActionAt: number | null;
};

export const INITIAL_STATE: MachineState = {
  level: 'normal',
  freePct: null,
  shedding: false,
  recoveredSince: null,
  severeTicks: 0,
  lastActionAt: null,
};

/** Poll interval while anything is happening, and while an engine is loaded but idle. */
export const FAST_MS = 500;
export const SLOW_MS = 10_000;

/** Largest model first: STT child ~1.6 GB after load, ~3.45 GB from the first request on (CPU decode); TTS ~460 MB. */
const UNLOAD_ORDER: readonly GuardEngine[] = ['stt', 'tts'];

const PRESSURE_CRITICAL = 4;

const isLoaded = (s: EngineState | null) => s === 'ready' || s === 'busy' || s === 'loading';

/** Level for one reading; kernel pressure 4 counts as critical even when the percentage looks fine. */
export function classify(r: Reading, cfg: GuardConfig): GuardLevel {
  const p = r.freePct;
  if (p !== null && p < cfg.emergencyPct) return 'emergency';
  if ((p !== null && p < cfg.criticalPct) || r.pressure === PRESSURE_CRITICAL) return 'critical';
  if (p !== null && p < cfg.warnPct) return 'warn';
  return 'normal';
}

/**
 * One tick: emergency unloads every loaded engine (STT first) at once; critical unloads idle
 * engines first and the largest busy one only if still critical on a later tick; both critical
 * steps respect the cooldown. Shedding starts at warn and stops after free ≥ RECOVER for RECOVER_SEC.
 */
export function step(
  prev: MachineState,
  reading: Reading,
  engines: EngineStates,
  now: number,
  cfg: GuardConfig,
): { state: MachineState; unloads: Unload[] } {
  const level = classify(reading, cfg);
  const severe = level === 'critical' || level === 'emergency';

  let shedding = prev.shedding || level !== 'normal';
  const recovered =
    level === 'normal' && (reading.freePct === null || reading.freePct >= cfg.recoverPct);
  let recoveredSince = shedding && recovered ? (prev.recoveredSince ?? now) : null;
  if (recoveredSince !== null && now - recoveredSince >= cfg.recoverSec * 1000) {
    shedding = false;
    recoveredSince = null;
  }

  const loaded = UNLOAD_ORDER.filter((k) => isLoaded(engines[k]));
  const cooled = prev.lastActionAt === null || now - prev.lastActionAt >= cfg.cooldownSec * 1000;
  let unloads: Unload[] = [];
  if (level === 'emergency') {
    unloads = loaded.map((engine) => ({ engine, reason: 'emergency' }));
  } else if (level === 'critical' && cooled) {
    const idle = loaded.filter((k) => engines[k] === 'ready');
    if (idle.length) unloads = idle.map((engine) => ({ engine, reason: 'idle' }));
    else if (prev.severeTicks > 0 && loaded.length)
      unloads = [{ engine: loaded[0], reason: 'busy' }];
  }

  return {
    state: {
      level,
      freePct: reading.freePct,
      shedding,
      recoveredSince,
      severeTicks: severe ? prev.severeTicks + 1 : 0,
      lastActionAt: unloads.length ? now : prev.lastActionAt,
    },
    unloads,
  };
}

/**
 * Next poll delay, or null to go idle (no timer): fast while under pressure, while an engine is
 * busy/loading or right after wake(); slow while an engine sits loaded or shedding waits to recover.
 */
export function nextDelay(
  state: MachineState,
  engines: EngineStates,
  now: number,
  wakeUntil: number,
): number | null {
  const s = Object.values(engines);
  if (state.level !== 'normal' || now < wakeUntil || s.some((x) => x === 'busy' || x === 'loading'))
    return FAST_MS;
  if (state.shedding || s.some((x) => x === 'ready')) return SLOW_MS;
  return null;
}

/** Seconds a shed client should wait: the rest of the recovery window, at least 1. */
export function retryAfterSec(state: MachineState, now: number, cfg: GuardConfig): number {
  const elapsed = state.recoveredSince === null ? 0 : (now - state.recoveredSince) / 1000;
  return Math.max(1, Math.ceil(cfg.recoverSec - elapsed));
}
