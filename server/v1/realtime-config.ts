/** /api/v1/realtime limits, read from env on every call (documented in .env.example). */

const num = (name: string, fallback: number): number => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export const rtConfig = {
  /** RT_MAX_SESSIONS (default 2): concurrent realtime sessions; more get 429 before the upgrade. */
  get maxSessions() {
    return Math.floor(num('RT_MAX_SESSIONS', 2));
  },
  /** RT_MAX_SESSION_SEC (default 1800): a session is closed (error event first) after this long. */
  get maxSessionSec() {
    return num('RT_MAX_SESSION_SEC', 1800);
  },
  /** RT_IDLE_TIMEOUT_SEC (default 120): a session with no client event for this long is closed. */
  get idleTimeoutSec() {
    return num('RT_IDLE_TIMEOUT_SEC', 120);
  },
  /** RT_MAX_TURN_SEC (default 60): one turn's buffered audio cap (VAD: auto-commit, manual: error + clear). */
  get maxTurnSec() {
    return num('RT_MAX_TURN_SEC', 60);
  },
};

/** Largest client frame; bigger frames are closed by Bun with 1009 (≈ 30 s of 24 kHz PCM16 as base64). */
export const RT_MAX_FRAME_BYTES = 2 * 1024 * 1024;

/** Close codes: policy/limits, internal failure, server under memory pressure. */
export const CLOSE = { policy: 1008, internal: 1011, tryAgain: 1013 } as const;
