/** docs/skill.md anti-drift: every /api/v1 route and v1 error code in the code is documented; /skill.md is served filled in. */
import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { api } from '../server/api';
import { env } from '../server/env';
import { agentDocResponse, llmsIndex, readmeText, skillText } from '../server/readme';

const ROOT = path.join(import.meta.dir, '..');
const doc = await Bun.file(path.join(ROOT, 'docs/skill.md')).text();
const errorTable = doc.slice(doc.indexOf('## Errors'), doc.indexOf('## Operational notes'));

/** Files that emit /api/v1 error codes (v1 routes plus the plugins/handlers that branch on isV1Path). */
const SOURCES = [
  ...new Bun.Glob('server/v1/*.ts').scanSync({ cwd: ROOT }),
  'server/audio/decode.ts',
  'server/memory-guard/plugin.ts',
  'server/middleware/rate-limiter.ts',
  'server/middleware/maintenance.ts',
  'server/api-keys/plugin.ts',
  'server/api-error.ts',
];

/** Not a v1 wire code: `typeof x.code === 'string'`, INTERNAL (sent as server_error), and the
 * non-v1 fallback ENDPOINT_NOT_ALLOWED (every v1 route has a scope or is public, so v1 never sees it). */
const NOT_WIRE_CODES = new Set(['string', 'internal', 'endpoint_not_allowed']);

/** Literal string passed as the `n`th argument (0-based) of every `fn(` call; quotes and nesting respected. */
function literalArgs(src: string, fn: string, n: number): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(new RegExp(`\\b${fn}\\(`, 'g'))) {
    const args: string[] = [];
    let start = (m.index ?? 0) + m[0].length;
    let depth = 0;
    let quote: string | null = null;
    for (let i = start; i < src.length; i++) {
      const c = src[i];
      if (quote) {
        if (c === '\\') i++;
        else if (c === quote) quote = null;
      } else if (c === "'" || c === '"' || c === '`') quote = c;
      else if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) {
        if (depth === 0) {
          args.push(src.slice(start, i));
          break;
        }
        depth--;
      } else if (c === ',' && depth === 0) {
        args.push(src.slice(start, i));
        start = i + 1;
      }
    }
    const lit = args[n]?.trim().match(/^'([A-Za-z_]+)'$/);
    if (lit) out.push(lit[1]);
  }
  return out;
}

async function v1Codes(): Promise<Set<string>> {
  const codes = new Set<string>();
  for (const file of SOURCES) {
    const src = await Bun.file(path.join(ROOT, file)).text();
    const found = [
      ...[...src.matchAll(/\bcode\s*(?:===|:|=)\s*'([A-Za-z_]+)'/g)].map((m) => m[1]),
      ...literalArgs(src, 'bad', 2),
      ...literalArgs(src, 'problem', 2),
      ...literalArgs(src, 'v1ErrorBody', 2),
      // `readonly code: 'unsupported_format' | 'invalid_audio'` (AudioDecodeError)
      ...[...src.matchAll(/readonly code: ([^;]+);/g)].flatMap((m) =>
        [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]),
      ),
      // api-error STATUS_BY_CODE keys (Elysia error codes, lowercased for v1)
      ...[...src.matchAll(/^ {2}([A-Z_]+): \d{3},$/gm)].map((m) => m[1]),
    ];
    for (const c of found) codes.add(c.toLowerCase());
  }
  for (const c of NOT_WIRE_CODES) codes.delete(c);
  return codes;
}

describe('docs/skill.md stays in sync with the code', () => {
  test('every /api/v1 route registered on the app is documented', () => {
    const routes = api.routes
      .filter((r) => r.path.startsWith('/api/v1'))
      .map((r) => `${r.method === 'WS' ? 'GET' : r.method} ${r.path}`);
    expect(routes).toContain('POST /api/v1/audio/transcriptions');
    expect(routes.length).toBeGreaterThanOrEqual(7);
    const missing = routes.filter((r) => !doc.includes(r));
    expect(missing).toEqual([]);
  });

  test('every v1 error code emitted by the code is in the error table', async () => {
    const codes = await v1Codes();
    // Guard against the extractor silently matching nothing.
    for (const c of ['engine_busy', 'invalid_audio', 'memory_pressure', 'missing_scope', 'parse'])
      expect(codes.has(c)).toBe(true);
    const missing = [...codes].filter((c) => !errorTable.includes(`\`${c}\``)).sort();
    expect(missing).toEqual([]);
  });

  test('literalArgs reads only the requested literal argument', () => {
    const src =
      "bad(`x ${a.join(', ')}`, 'p', 'unsupported_value'); bad('m', 'q'); bad(f(1, 2), 'r', 'zz')";
    expect(literalArgs(src, 'bad', 2)).toEqual(['unsupported_value', 'zz']);
  });
});

describe('/skill.md endpoint', () => {
  test('serves markdown with {{BASE_URL}} replaced by APP_URL', async () => {
    const res = await agentDocResponse(new Request('http://localhost/skill.md'), '/skill.md');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(res.headers.get('etag')).toBeTruthy();
    const body = await res.text();
    const base = env.APP_URL.replace(/\/$/, '');
    expect(body).not.toContain('{{');
    expect(body).toContain(`base_url = ${base}/api/v1`);
    expect(body.startsWith('---\nname: s4s-speech\n')).toBe(true);
  });

  test('skillText strips a trailing slash from the base URL', async () => {
    const text = await skillText('https://speech.example.test/');
    expect(text).toContain('https://speech.example.test/api/v1/audio/speech');
    expect(text).not.toContain('example.test//');
  });

  test('llms.txt links the skill first', async () => {
    const idx = llmsIndex(await readmeText(), 'https://example.test');
    const firstLink = idx.split('\n').find((l) => l.startsWith('- ['));
    expect(firstLink).toStartWith('- [Pakai API ini (skill)](https://example.test/skill.md)');
  });
});
