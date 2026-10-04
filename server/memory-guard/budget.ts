/**
 * Pre-admission RAM budget for COLD engine loads. A cold load reserves its budget in memory until
 * the engine settles, so two loads racing (STT + TTS) are both counted against the same free RAM.
 */
import type { EngineState } from '../engines/types';
import type { EngineStates, GuardEngine } from './machine';

export const MB = 1024 * 1024;
/** A reservation whose engine never started loading is dropped after this (the request failed before reaching it). */
export const RESERVE_START_GRACE_MS = 15_000;
/** Hard cap for a reservation stuck in loading, so a hung load cannot block the other engine forever. */
export const RESERVE_MAX_MS = 5 * 60_000;

const LABEL: Record<GuardEngine, string> = { stt: 'STT', tts: 'TTS' };
const nf = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });

/** Indonesian, actionable reason for a refused cold load (MB in id-ID format). */
export const BUDGET_MESSAGE = (r: {
  engine: GuardEngine;
  neededMb: number;
  availableMb: number;
  retryAfterSec: number;
}) =>
  `RAM server tidak cukup untuk memuat engine ${LABEL[r.engine]}: butuh ${nf.format(r.neededMb)} MB, tersedia ${nf.format(r.availableMb)} MB. Tutup aplikasi lain yang berat atau coba lagi dalam ${r.retryAfterSec} detik.`;

/** Last cold load the budget refused (shown on /dev/engines). */
export type BudgetRefusal = {
  engine: GuardEngine;
  neededMb: number;
  availableMb: number;
  at: string;
};

export type BudgetCheck = { ok: true } | { ok: false; neededMb: number; availableMb: number };

type Reservation = { bytes: number; since: number; sawLoading: boolean };

const isLoaded = (s: EngineState | null) => s === 'ready' || s === 'busy' || s === 'loading';

/** Budget bookkeeping for one guard; `budgetMb` 0 disables the check for that engine. */
export function createBudget(budgetMb: Record<GuardEngine, number>) {
  const reservations = new Map<GuardEngine, Reservation>();

  const reservedBytes = (except?: GuardEngine) => {
    let sum = 0;
    for (const [k, r] of reservations) if (k !== except) sum += r.bytes;
    return sum;
  };

  return {
    /** Release reservations whose load finished or failed, never started, or ran past RESERVE_MAX_MS. */
    settle(states: EngineStates, now: number): void {
      for (const [engine, r] of reservations) {
        const s = states[engine];
        const age = now - r.since;
        if (s === 'loading') r.sawLoading = true;
        const done =
          s === 'ready' ||
          s === 'busy' ||
          (s === 'loading' ? age > RESERVE_MAX_MS : r.sawLoading || age > RESERVE_START_GRACE_MS);
        if (done) reservations.delete(engine);
      }
    },

    /**
     * Admit a request that may load `engine`. Loaded engines, engines whose load is already reserved,
     * unknown states and an unknown free figure pass; otherwise free RAM minus other reservations must
     * cover the budget, and passing reserves it.
     */
    check(
      engine: GuardEngine,
      state: EngineState | null,
      freeBytes: () => number | null,
      now: number,
    ): BudgetCheck {
      const needed = budgetMb[engine];
      if (needed <= 0 || state === null || isLoaded(state) || reservations.has(engine))
        return { ok: true };
      const free = freeBytes();
      if (free === null) return { ok: true };
      const available = free - reservedBytes(engine);
      if (available < needed * MB)
        return {
          ok: false,
          neededMb: needed,
          availableMb: Math.max(0, Math.floor(available / MB)),
        };
      reservations.set(engine, { bytes: needed * MB, since: now, sawLoading: false });
      return { ok: true };
    },

    /** Total MB currently reserved by cold loads in progress. */
    reservedMb: () => Math.round(reservedBytes() / MB),
  };
}

export type Budget = ReturnType<typeof createBudget>;
