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
export const isEngineUnloadedError = (err: unknown): err is EngineUnloadedError => err instanceof EngineUnloadedError;

/** Template-shaped 503 body (`{ error, code, status, requestId }`) for non-v1 routes. */
export function engineUnloadedApiError(requestId: string) {
  return { error: ENGINE_UNLOADED_MESSAGE, code: 'ENGINE_UNLOADED', status: 503 as const, requestId };
}
