/**
 * Read side of the memory guard, shared through globalThis so the SSR bundle copy and the API see
 * the guard started at boot. Imports nothing native, so app/ code may depend on it.
 */
import type { BudgetRefusal } from './budget';
import type { GuardEngine, GuardLevel, UnloadReason } from './machine';

export type GuardLastAction = {
  kind: 'unload';
  engine: GuardEngine;
  reason: UnloadReason;
  at: string;
  /** false when the unload failed or did not finish within the timeout. */
  ok: boolean;
};

export type MemoryGuardStatus = {
  enabled: boolean;
  /** A poll timer is armed (false = idle because no engine is loaded). */
  active: boolean;
  level: GuardLevel;
  freePct: number | null;
  pressure: number | null;
  shedding: boolean;
  lastAction: GuardLastAction | null;
  /** Free RAM a cold load of each engine needs (0 = check disabled). */
  budgetMb: Record<GuardEngine, number>;
  /** MB held by cold loads still in progress. */
  reservedMb: number;
  lastRefusal: BudgetRefusal | null;
};

/** `pressure` = RAM low, shedding all new work; `budget` = not enough free RAM to cold-load that engine. */
export type Admission =
  | { ok: true }
  | { ok: false; reason: 'pressure'; retryAfterSec: number }
  | ({ ok: false; reason: 'budget'; retryAfterSec: number } & Omit<BudgetRefusal, 'at'>);

/** What the API needs from the running guard. */
export interface GuardHandle {
  status(): MemoryGuardStatus;
  /**
   * Re-read memory now, poll fast for a while, and say whether new speech work may start; with
   * `engine`, a cold load of it must also fit the RAM budget (and reserves it).
   */
  admit(engine?: GuardEngine): Admission;
}

const g = globalThis as typeof globalThis & { __s4sMemoryGuard?: GuardHandle };

/** The running guard, or null when it is disabled or not started (tests, scripts). */
export function guardHandle(): GuardHandle | null {
  return g.__s4sMemoryGuard ?? null;
}

/** Install or clear the process-wide guard (boot code and tests). */
export function setGuardHandle(h: GuardHandle | null): void {
  if (h) g.__s4sMemoryGuard = h;
  else delete g.__s4sMemoryGuard;
}

const DISABLED: MemoryGuardStatus = {
  enabled: false,
  active: false,
  level: 'normal',
  freePct: null,
  pressure: null,
  shedding: false,
  lastAction: null,
  budgetMb: { stt: 0, tts: 0 },
  reservedMb: 0,
  lastRefusal: null,
};

/** Guard status for /api/engines; a disabled placeholder when no guard runs. */
export function memoryGuardStatus(): MemoryGuardStatus {
  return guardHandle()?.status() ?? DISABLED;
}
