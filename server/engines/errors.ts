/** Seconds a client should wait after an unload before retrying; the next request reloads the model. */
export const UNLOADED_RETRY_SEC = 5;

/** User-facing message for non-v1 callers that hit an unloaded engine. */
export const ENGINE_UNLOADED_MESSAGE = 'Engine dihentikan karena RAM menipis atau idle. Coba lagi.';

/** A queued or in-flight job was dropped because its engine was unloaded (memory guard, idle, shutdown, /dev). */
export class EngineUnloadedError extends Error {
  readonly retryAfterSec = UNLOADED_RETRY_SEC;
  constructor(readonly kind: 'stt' | 'tts') {
    super(`${kind.toUpperCase()} engine unloaded`);
    this.name = 'EngineUnloadedError';
  }
}

/** Type guard for EngineUnloadedError. */
export const isEngineUnloadedError = (err: unknown): err is EngineUnloadedError =>
  err instanceof EngineUnloadedError;

/** Template-shaped 503 body (`{ error, code, status, requestId }`) for non-v1 routes. */
export function engineUnloadedApiError(requestId: string) {
  return {
    error: ENGINE_UNLOADED_MESSAGE,
    code: 'ENGINE_UNLOADED',
    status: 503 as const,
    requestId,
  };
}

/** Generic 503 text for an engine that failed to become ready; the detail stays in /dev/engines and the log. */
export const engineLoadFailedMessage = (kind: 'stt' | 'tts') =>
  `Mesin ${kind.toUpperCase()} gagal dimuat. Periksa status engine di /dev/engines, lalu muat ulang engine.`;

/** The engine could not become ready (load failure, crash during load, or failed self-test); not transient. */
export class EngineNotReadyError extends Error {
  constructor(
    readonly kind: 'stt' | 'tts',
    /** Operator-facing reason (also the engine's lastError); never sent to API clients. */
    readonly detail: string,
  ) {
    super(engineLoadFailedMessage(kind));
    this.name = 'EngineNotReadyError';
  }
}

/** Type guard for EngineNotReadyError. */
export const isEngineNotReadyError = (err: unknown): err is EngineNotReadyError =>
  err instanceof EngineNotReadyError;
