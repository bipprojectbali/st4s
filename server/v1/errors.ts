import type { EngineUnloadedError } from '../engines/errors';

/** OpenAI-style error body: { error: { message, type, param, code } }. */
export type V1ErrorType =
  | 'invalid_request_error'
  | 'authentication_error'
  | 'permission_error'
  | 'not_found_error'
  | 'rate_limit_error'
  | 'server_error';

const TYPE_BY_STATUS: Record<number, V1ErrorType> = {
  400: 'invalid_request_error',
  401: 'authentication_error',
  403: 'permission_error',
  404: 'not_found_error',
  413: 'invalid_request_error',
  415: 'invalid_request_error',
  422: 'invalid_request_error',
  429: 'rate_limit_error',
};

export const V1_PREFIX = '/api/v1';

/** True for paths served by the OpenAI-compatible API (they answer errors in OpenAI shape). */
export function isV1Path(pathname: string): boolean {
  return pathname === V1_PREFIX || pathname.startsWith(`${V1_PREFIX}/`);
}

export function v1ErrorBody(status: number, message: string, code: string | null = null, param: string | null = null) {
  return { error: { message, type: TYPE_BY_STATUS[status] ?? 'server_error', param, code } };
}

export function v1Error(
  status: number,
  message: string,
  opts: { code?: string | null; param?: string | null; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(v1ErrorBody(status, message, opts.code ?? null, opts.param ?? null)), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...opts.headers },
  });
}

/** 503 engine_unloaded + Retry-After: the job was dropped by an unload; a retry reloads the engine. */
export function v1EngineUnloaded(err: EngineUnloadedError): Response {
  return v1Error(503, `Mesin ${err.kind.toUpperCase()} dihentikan karena RAM menipis atau idle. Coba lagi beberapa detik lagi.`, {
    code: 'engine_unloaded',
    headers: { 'retry-after': String(err.retryAfterSec) },
  });
}

/** Template error codes (UPPER_SNAKE) become OpenAI-style lower_snake codes. */
export const v1Code = (code: unknown): string | null =>
  typeof code === 'string' && code ? code.toLowerCase() : null;
