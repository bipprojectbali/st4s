/**
 * AUTH_DISABLE_SIGNUP: default resolution by NODE_ENV, and the real Better Auth
 * wiring. The auth instance reads the flag once at import, so each env value is
 * exercised in a child `bun` process against the test DB.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import path from 'node:path';
import { inArray } from 'drizzle-orm';
import { api } from '../server/api';
import { db } from '../server/db';
import { user } from '../server/db/schema';
import { resolveSignupDisabled } from '../server/env';

const ROOT = path.join(import.meta.dir, '..');
const PASSWORD = 'TestPass123!';
const EXISTING = `signup-existing-${crypto.randomUUID()}@test.local`;
const created: string[] = [EXISTING];

const PROBE = `
const { api } = await import('./server/api');
const post = (p, body) => api.handle(new Request('http://localhost/api/auth/' + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}));
const up = await post('sign-up/email', { email: process.env.PROBE_NEW, password: process.env.PROBE_PASS, name: 'Probe' });
const inn = await post('sign-in/email', { email: process.env.PROBE_EXISTING, password: process.env.PROBE_PASS });
console.log(JSON.stringify({ signUp: up.status, signIn: inn.status }));
process.exit(0);
`;

async function probe(disable: 'true' | 'false'): Promise<{ signUp: number; signIn: number }> {
  const fresh = `signup-new-${crypto.randomUUID()}@test.local`;
  created.push(fresh);
  const proc = Bun.spawn(['bun', '-e', PROBE], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      AUTH_DISABLE_SIGNUP: disable,
      PROBE_NEW: fresh,
      PROBE_EXISTING: EXISTING,
      PROBE_PASS: PASSWORD,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (code !== 0)
    throw new Error(`signup probe exited ${code}: ${await new Response(proc.stderr).text()}`);
  const line = out
    .trim()
    .split('\n')
    .reverse()
    .find((l) => l.startsWith('{"signUp"'));
  if (!line) throw new Error(`signup probe printed no result: ${out.slice(-500)}`);
  return JSON.parse(line);
}

beforeAll(async () => {
  const res = await api.handle(
    new Request('http://localhost/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EXISTING, password: PASSWORD, name: 'Existing' }),
    }),
  );
  expect(res.status).toBe(200);
});

afterAll(async () => {
  await db.delete(user).where(inArray(user.email, created));
});

describe('resolveSignupDisabled', () => {
  test('defaults to closed in production and open elsewhere', () => {
    expect(resolveSignupDisabled(undefined, 'production')).toBe(true);
    expect(resolveSignupDisabled(undefined, 'development')).toBe(false);
    expect(resolveSignupDisabled(undefined, 'test')).toBe(false);
  });

  test('an explicit value wins over NODE_ENV', () => {
    expect(resolveSignupDisabled('false', 'production')).toBe(false);
    expect(resolveSignupDisabled('true', 'development')).toBe(true);
  });
});

describe('AUTH_DISABLE_SIGNUP wiring', () => {
  test('true → sign-up rejected, existing user can still sign in', async () => {
    const r = await probe('true');
    expect(r.signUp).toBe(400);
    expect(r.signIn).toBe(200);
  }, 30_000);

  test('false → sign-up works', async () => {
    const r = await probe('false');
    expect(r.signUp).toBe(200);
    expect(r.signIn).toBe(200);
  }, 30_000);
});
