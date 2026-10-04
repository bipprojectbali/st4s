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

export function v1ErrorBody(status: number, message: string, code: string | null = null, param: string | null = null) {
  return { error: { message, type: TYPE_BY_STATUS[status] ?? 'server_error', param, code } };
}

export function v1Error(
  status: number,
  message: string,
  opts: { code?: string; param?: string; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(v1ErrorBody(status, message, opts.code ?? null, opts.param ?? null)), {
    status,
    headers: { 'content-type': 'application/json', ...opts.headers },
  });
}
