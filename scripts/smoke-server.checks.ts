/**
 * Black-box checks a running st4s server (script or binary) must pass.
 * Pure data + evaluator so the list is unit-tested and shared by the runner.
 */
export type SmokeCheck = {
  name: string;
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Expected status(es). */
  status: number | number[];
  /** Substring the content-type must contain. */
  contentType?: string;
  /** Substring the body must contain. */
  bodyIncludes?: string;
  /** Header that must be present (value substring optional). */
  header?: { name: string; includes?: string };
};

export const SMOKE_CHECKS: SmokeCheck[] = [
  {
    name: 'versi build',
    path: '/api/version',
    status: 200,
    contentType: 'application/json',
    bodyIncludes: '"version"',
  },
  { name: 'landing SSR', path: '/', status: 200, contentType: 'text/html', bodyIncludes: '<html' },
  { name: 'halaman login', path: '/login', status: 200, contentType: 'text/html' },
  {
    name: 'area super-admin anonim → login',
    path: '/dev',
    status: 302,
    header: { name: 'location', includes: '/login' },
  },
  { name: 'favicon svg', path: '/favicon.svg', status: 200, contentType: 'image/svg+xml' },
  {
    name: 'favicon.ico → svg',
    path: '/favicon.ico',
    status: 302,
    header: { name: 'location', includes: '/favicon.svg' },
  },
  {
    name: 'probe devtools',
    path: '/.well-known/appspecific/com.chrome.devtools.json',
    status: 404,
  },
  {
    name: 'halaman 404 bermerek',
    path: '/halaman-yang-tidak-ada',
    status: 404,
    contentType: 'text/html',
    bodyIncludes: 'Halaman tidak ditemukan',
  },
  {
    name: 'API 404 JSON',
    path: '/api/tidak-ada',
    status: 404,
    contentType: 'application/json',
    bodyIncludes: '"code":"NOT_FOUND"',
    header: { name: 'x-request-id' },
  },
  {
    name: 'API method salah → 404 JSON',
    path: '/api/version',
    method: 'DELETE',
    status: 404,
    contentType: 'application/json',
  },
  {
    name: 'Better Auth hidup',
    path: '/api/auth/get-session',
    status: 200,
    contentType: 'application/json',
  },
  {
    name: 'API key palsu ditolak',
    path: '/api/me/logins',
    headers: { 'x-api-key': 'mk_live_bogus' },
    status: 401,
    bodyIncludes: 'INVALID_API_KEY',
  },
  {
    name: 'MCP anonim ditolak',
    path: '/api/mcp',
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: '{}',
    status: 401,
  },
  {
    name: 'README untuk agent',
    path: '/README.md',
    status: 200,
    contentType: 'text/markdown',
    bodyIncludes: '## Untuk AI agent',
    header: { name: 'etag' },
  },
  {
    name: 'skill.md untuk agent',
    path: '/skill.md',
    status: 200,
    contentType: 'text/markdown',
    bodyIncludes: '/api/v1 and your API key',
  },
  {
    name: 'llms.txt',
    path: '/llms.txt',
    status: 200,
    contentType: 'text/plain',
    bodyIncludes: '# st4s',
  },
  {
    name: 'landing meta OG',
    path: '/',
    status: 200,
    bodyIncludes: 'og.png',
  },
  {
    name: 'robots.txt',
    path: '/robots.txt',
    status: 200,
    contentType: 'text/plain',
    bodyIncludes: 'Sitemap:',
  },
  {
    name: 'sitemap.xml',
    path: '/sitemap.xml',
    status: 200,
    contentType: 'application/xml',
    bodyIncludes: '<urlset',
  },
  { name: 'gambar OG', path: '/og.png', status: 200, contentType: 'image/png' },
  {
    name: 'apple-touch-icon',
    path: '/apple-touch-icon.png',
    status: 200,
    contentType: 'image/png',
  },
  {
    name: 'rate limit header',
    path: '/api/hello',
    status: 200,
    header: { name: 'x-ratelimit-limit' },
  },
  {
    name: 'realtime WS tanpa auth',
    path: '/api/v1/realtime',
    headers: {
      upgrade: 'websocket',
      connection: 'Upgrade',
      'sec-websocket-version': '13',
      'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
    },
    status: 401,
    contentType: 'application/json',
    bodyIncludes: 'authentication_error',
  },
];

export type SmokeResult = { name: string; ok: boolean; detail: string };

/** Evaluate one check against a response (body already read). */
export function evaluate(
  check: SmokeCheck,
  res: { status: number; headers: Headers; body: string },
): SmokeResult {
  const problems: string[] = [];
  const expected = Array.isArray(check.status) ? check.status : [check.status];
  if (!expected.includes(res.status)) problems.push(`status ${res.status} ≠ ${expected.join('|')}`);
  const ct = res.headers.get('content-type') ?? '';
  if (check.contentType && !ct.includes(check.contentType))
    problems.push(`content-type "${ct}" tanpa "${check.contentType}"`);
  if (check.bodyIncludes && !res.body.includes(check.bodyIncludes))
    problems.push(`body tanpa "${check.bodyIncludes}"`);
  if (check.header) {
    const v = res.headers.get(check.header.name);
    if (v === null) problems.push(`header ${check.header.name} hilang`);
    else if (check.header.includes && !v.includes(check.header.includes))
      problems.push(`header ${check.header.name}="${v}" tanpa "${check.header.includes}"`);
  }
  return {
    name: check.name,
    ok: problems.length === 0,
    detail: problems.join('; ') || `${res.status}`,
  };
}

/** Run every check against a base URL; the hashed client asset is discovered from the landing HTML. */
export async function runChecks(base: string, checks = SMOKE_CHECKS): Promise<SmokeResult[]> {
  const results: SmokeResult[] = [];
  for (const c of checks) {
    const res = await fetch(base + c.path, {
      method: c.method ?? 'GET',
      headers: c.headers,
      body: c.body,
      redirect: 'manual',
    });
    results.push(evaluate(c, { status: res.status, headers: res.headers, body: await res.text() }));
  }
  const html = await (await fetch(`${base}/`)).text();
  const asset = html.match(/\/assets\/[^"']+\.js/)?.[0];
  if (!asset)
    results.push({ name: 'aset client', ok: false, detail: 'tidak ada /assets/*.js di HTML' });
  else {
    const res = await fetch(base + asset);
    results.push(
      evaluate(
        {
          name: `aset client ${asset}`,
          path: asset,
          status: 200,
          contentType: 'javascript',
          header: { name: 'cache-control', includes: 'immutable' },
        },
        { status: res.status, headers: res.headers, body: '' },
      ),
    );
  }
  return results;
}
