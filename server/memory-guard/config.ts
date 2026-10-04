/** MEM_GUARD_* settings, validated once at boot (a bad ordering stops the server with a clear message). */

export type GuardConfig = {
  enabled: boolean;
  /** Free % below which new speech work is shed (503). */
  warnPct: number;
  /** Free % below which idle engines are unloaded (then busy ones on the next tick). */
  criticalPct: number;
  /** Free % below which STT, then TTS, are unloaded immediately. */
  emergencyPct: number;
  /** Shedding stops once free % stays at or above this for recoverSec. */
  recoverPct: number;
  recoverSec: number;
  /** Minimum gap between unload rounds so freed memory can show up in the reading. */
  cooldownSec: number;
};

export const GUARD_DEFAULTS: GuardConfig = {
  enabled: true,
  warnPct: 30,
  criticalPct: 20,
  emergencyPct: 12,
  recoverPct: 40,
  recoverSec: 30,
  cooldownSec: 3,
};

type Env = Record<string, string | undefined>;

function pct(env: Env, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0 || v >= 100) throw new Error(`${name} harus angka 1–99 (persen RAM bebas), dapat "${raw}".`);
  return v;
}

function seconds(env: Env, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 0) throw new Error(`${name} harus angka detik ≥ 0, dapat "${raw}".`);
  return v;
}

/** Parse and validate MEM_GUARD_*; throws when a value is malformed or the thresholds are out of order. */
export function loadGuardConfig(env: Env = process.env): GuardConfig {
  const d = GUARD_DEFAULTS;
  const cfg: GuardConfig = {
    enabled: env.MEM_GUARD_ENABLED?.trim().toLowerCase() !== 'false',
    warnPct: pct(env, 'MEM_GUARD_WARN_PCT', d.warnPct),
    criticalPct: pct(env, 'MEM_GUARD_CRITICAL_PCT', d.criticalPct),
    emergencyPct: pct(env, 'MEM_GUARD_EMERGENCY_PCT', d.emergencyPct),
    recoverPct: pct(env, 'MEM_GUARD_RECOVER_PCT', d.recoverPct),
    recoverSec: seconds(env, 'MEM_GUARD_RECOVER_SEC', d.recoverSec),
    cooldownSec: seconds(env, 'MEM_GUARD_COOLDOWN_SEC', d.cooldownSec),
  };
  if (!(cfg.emergencyPct < cfg.criticalPct && cfg.criticalPct < cfg.warnPct && cfg.warnPct < cfg.recoverPct))
    throw new Error(
      `MEM_GUARD_* harus berurutan EMERGENCY < CRITICAL < WARN < RECOVER, dapat ${cfg.emergencyPct} / ${cfg.criticalPct} / ${cfg.warnPct} / ${cfg.recoverPct}. Perbaiki .env lalu restart.`,
    );
  return cfg;
}
