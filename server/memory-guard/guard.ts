/**
 * Memory guard runner: one unref'd setTimeout chain that reads RAM, steps the state machine,
 * unloads engines when told to, and goes fully idle (no timer) while no engine is loaded.
 */
import type { EngineControl, EngineState } from '../engines/types';
import { logger } from '../logger';
import { type BudgetRefusal, createBudget } from './budget';
import type { GuardConfig } from './config';
import {
  type EngineStates,
  type GuardEngine,
  type GuardLevel,
  INITIAL_STATE,
  type MachineState,
  nextDelay,
  type Reading,
  retryAfterSec,
  step,
  type Unload,
} from './machine';
import type { Admission, GuardHandle, GuardLastAction, MemoryGuardStatus } from './state';

/** Poll fast this long after wake() so an engine that starts loading right after admission is watched. */
export const WAKE_GRACE_MS = 60_000;
/** An unload that has not settled by then is logged as stuck; the next round may try again. */
export const UNLOAD_TIMEOUT_MS = 2_000;

/** What one guard unload reports to the audit log (no request data, metrics only). */
export type GuardAuditEntry = {
  engine: GuardEngine;
  reason: Unload['reason'];
  level: GuardLevel;
  freePct: number | null;
  ms: number;
  ok: boolean;
};

/** Everything the runner touches outside itself, injectable for tests. */
export type GuardDeps = {
  cfg: GuardConfig;
  read: () => Reading;
  engines: () => Partial<Record<GuardEngine, EngineControl>>;
  audit: (entry: GuardAuditEntry) => void;
  now?: () => number;
  /** Arm a one-shot timer; returns its cancel function. */
  schedule?: (fn: () => void, ms: number) => () => void;
  unloadTimeoutMs?: number;
};

/** A running guard: the API-facing handle plus lifecycle controls. */
export type MemoryGuard = GuardHandle & {
  start(): void;
  stop(): void;
  /** Poll fast for WAKE_GRACE_MS (an engine is about to load). */
  wake(): void;
  /** Run one tick now (tests); resolves after its unloads settle. */
  tick(): Promise<void>;
};

const SEVERITY: Record<GuardLevel, number> = { normal: 0, warn: 1, critical: 2, emergency: 3 };

function defaultSchedule(fn: () => void, ms: number): () => void {
  const t = setTimeout(fn, ms);
  t.unref();
  return () => clearTimeout(t);
}

function stateOf(e: EngineControl | undefined, engine: GuardEngine): EngineState | null {
  if (!e) return null;
  try {
    return e.status().state;
  } catch (err) {
    logger.warn({ err, engine }, 'memory guard: engine status() failed');
    return null;
  }
}

async function unloadWithin(e: EngineControl, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([e.unload().then(() => true as const), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Build a guard; nothing runs until start(). */
export function createMemoryGuard(deps: GuardDeps): MemoryGuard {
  const { cfg } = deps;
  const now = deps.now ?? Date.now;
  const schedule = deps.schedule ?? defaultSchedule;
  const unloadTimeoutMs = deps.unloadTimeoutMs ?? UNLOAD_TIMEOUT_MS;

  let state: MachineState = INITIAL_STATE;
  let pressure: number | null = null;
  let lastAction: GuardLastAction | null = null;
  let cancel: (() => void) | null = null;
  let inFlight = false;
  let started = false;
  let wakeUntil = 0;
  let lastRefusal: BudgetRefusal | null = null;
  const budget = createBudget(cfg.budgetMb);

  const engineStates = (controls: ReturnType<GuardDeps['engines']>): EngineStates => ({
    stt: stateOf(controls.stt, 'stt'),
    tts: stateOf(controls.tts, 'tts'),
  });

  function logTransition(prev: MachineState, next: MachineState): void {
    const ctx = { level: next.level, from: prev.level, freePct: next.freePct, pressure };
    if (next.level !== prev.level) {
      if (SEVERITY[next.level] <= SEVERITY[prev.level])
        logger.info(ctx, 'memory guard: pressure eased');
      else if (next.level === 'warn') logger.warn(ctx, 'memory guard: RAM low');
      else logger.error(ctx, 'memory guard: RAM critically low');
    }
    if (next.shedding !== prev.shedding) {
      if (next.shedding)
        logger.warn({ ...ctx, action: 'shed' }, 'memory guard: rejecting new speech requests');
      else
        logger.info(
          { ...ctx, action: 'admit' },
          'memory guard: RAM recovered, accepting speech requests again',
        );
    }
  }

  async function runUnload(u: Unload, controls: ReturnType<GuardDeps['engines']>): Promise<void> {
    const e = controls[u.engine];
    if (!e) return;
    const ctx = {
      engine: u.engine,
      reason: u.reason,
      level: state.level,
      freePct: state.freePct,
      action: 'unload',
    };
    logger.error(ctx, 'memory guard: unloading engine');
    const t0 = performance.now();
    let ok = false;
    try {
      ok = await unloadWithin(e, unloadTimeoutMs);
      if (!ok)
        logger.error(
          { ...ctx, timeoutMs: unloadTimeoutMs },
          'memory guard: engine unload did not finish in time',
        );
    } catch (err) {
      logger.error({ ...ctx, err }, 'memory guard: engine unload failed');
    }
    const ms = Math.round(performance.now() - t0);
    lastAction = {
      kind: 'unload',
      engine: u.engine,
      reason: u.reason,
      at: new Date(now()).toISOString(),
      ok,
    };
    deps.audit({
      engine: u.engine,
      reason: u.reason,
      level: state.level,
      freePct: state.freePct,
      ms,
      ok,
    });
  }

  function arm(): void {
    cancel?.();
    cancel = null;
    if (!started) return;
    const delay = nextDelay(state, engineStates(deps.engines()), now(), wakeUntil);
    if (delay !== null) cancel = schedule(() => void tick(), delay);
  }

  /** Read, step and log synchronously, then await unloads before arming the next timer. */
  async function tick(): Promise<void> {
    if (inFlight) return;
    inFlight = true;
    cancel?.();
    cancel = null;
    try {
      const reading = deps.read();
      pressure = reading.pressure;
      const controls = deps.engines();
      const states = engineStates(controls);
      budget.settle(states, now());
      const prev = state;
      const r = step(prev, reading, states, now(), cfg);
      state = r.state;
      logTransition(prev, state);
      for (const u of r.unloads) await runUnload(u, controls);
    } catch (err) {
      logger.error({ err }, 'memory guard: tick failed');
    } finally {
      inFlight = false;
      arm();
    }
  }

  /** Free bytes for the budget; null when the reading is the unreliable fallback (freePct null). */
  function freeBytes(): number | null {
    const r = deps.read();
    return r.freePct === null ? null : (r.freeBytes ?? null);
  }

  function admitEngine(engine: GuardEngine): Admission {
    const states = engineStates(deps.engines());
    budget.settle(states, now());
    const c = budget.check(engine, states[engine], freeBytes, now());
    if (c.ok) return c;
    const retry = retryAfterSec(state, now(), cfg);
    lastRefusal = {
      engine,
      neededMb: c.neededMb,
      availableMb: c.availableMb,
      at: new Date(now()).toISOString(),
    };
    logger.warn(
      {
        engine,
        neededMb: c.neededMb,
        availableMb: c.availableMb,
        freePct: state.freePct,
        action: 'refuse-load',
      },
      'memory guard: not enough free RAM to load engine',
    );
    return {
      ok: false,
      reason: 'budget',
      retryAfterSec: retry,
      engine,
      neededMb: c.neededMb,
      availableMb: c.availableMb,
    };
  }

  function wake(): void {
    wakeUntil = now() + WAKE_GRACE_MS;
    if (started) void tick();
  }

  return {
    start() {
      if (started) return;
      started = true;
      void tick();
    },
    stop() {
      started = false;
      cancel?.();
      cancel = null;
    },
    wake,
    admit(engine?: GuardEngine): Admission {
      wake();
      if (state.shedding)
        return { ok: false, reason: 'pressure', retryAfterSec: retryAfterSec(state, now(), cfg) };
      return engine ? admitEngine(engine) : { ok: true };
    },
    status(): MemoryGuardStatus {
      return {
        enabled: true,
        active: cancel !== null || inFlight,
        level: state.level,
        freePct: state.freePct,
        pressure,
        shedding: state.shedding,
        lastAction,
        budgetMb: { ...cfg.budgetMb },
        reservedMb: budget.reservedMb(),
        lastRefusal,
      };
    },
    tick,
  };
}
