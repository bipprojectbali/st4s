/** The smoke checklist itself: well-formed entries and a correct evaluator (no server needed). */
import { describe, expect, test } from 'bun:test';
import { evaluate, SMOKE_CHECKS } from '../scripts/smoke-server.checks';

const res = (status: number, headers: Record<string, string> = {}, body = '') => ({
  status,
  headers: new Headers(headers),
  body,
});

describe('smoke checks', () => {
  test('list covers the public surface with unique names and absolute paths', () => {
    const names = SMOKE_CHECKS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const c of SMOKE_CHECKS) expect(c.path.startsWith('/')).toBe(true);
    for (const p of [
      '/api/version',
      '/README.md',
      '/llms.txt',
      '/skill.md',
      '/favicon.ico',
      '/api/mcp',
      '/api/v1/realtime',
    ])
      expect(SMOKE_CHECKS.some((c) => c.path === p)).toBe(true);
  });
  test('evaluate reports every mismatch and passes exact matches', () => {
    const check = SMOKE_CHECKS.find((c) => c.name === 'API 404 JSON');
    if (!check) throw new Error('check missing');
    const ok = evaluate(
      check,
      res(
        404,
        { 'content-type': 'application/json', 'x-request-id': 'r1' },
        '{"code":"NOT_FOUND"}',
      ),
    );
    expect(ok.ok).toBe(true);
    const bad = evaluate(check, res(500, { 'content-type': 'text/html' }, 'oops'));
    expect(bad.ok).toBe(false);
    expect(bad.detail).toContain('status 500');
    expect(bad.detail).toContain('content-type');
    expect(bad.detail).toContain('x-request-id hilang');
    const redirect = evaluate(
      {
        name: 'r',
        path: '/dev',
        status: [301, 302],
        header: { name: 'location', includes: '/login' },
      },
      res(302, { location: 'http://x/login' }),
    );
    expect(redirect.ok).toBe(true);
  });
});
