/**
 * Email sign-up/sign-in gate: AUTH_DISABLE_SIGNUP parsing + default, the pure
 * rule, and the real Better Auth hook. The auth instance reads env once at
 * import, so env-dependent cases run in a child `bun` process against the
 * test DB; DB-setting cases run in-process.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import path from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import { api } from '../server/api';
import { AUTH_GATE_ERRORS } from '../server/auth';
import { db } from '../server/db';
import { appSetting, user } from '../server/db/schema';
import { EnvSchema, resolveSignupDisabled } from '../server/env';
import { resolveEmailAuthGate } from '../server/settings-auth';
import {
  invalidateSettingsCache,
  readSettingsRow,
  SINGLETON_ID,
  type SettingsRow,
  upsertSettingsRow,
} from '../server/settings.core';

const ROOT = path.join(import.meta.dir, '..');
const PASSWORD = 'TestPass123!';
const EXISTING = `signup-existing-${crypto.randomUUID()}@test.local`;
const created: string[] = [EXISTING];
let original: SettingsRow | null = null;

type Probe = { signUp: number; signIn: number; signUpCode?: string; signInCode?: string };

const PROBE = `
const { api } = await import('./server/api');
const post = async (p, body) => {
  const r = await api.handle(new Request('http://localhost/api/auth/' + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
  const j = await r.json().catch(() => ({}));
  return [r.status, j.code];
};
const [signUp, signUpCode] = await post('sign-up/email', { email: process.env.PROBE_NEW, password: process.env.PROBE_PASS, name: 'Probe' });
const [signIn, signInCode] = await post('sign-in/email', { email: process.env.PROBE_EXISTING, password: process.env.PROBE_PASS });
console.log(JSON.stringify({ signUp, signIn, signUpCode, signInCode }));
process.exit(0);
`;

async function probe(env: Record<string, string>): Promise<Probe> {
  const fresh = `signup-new-${crypto.randomUUID()}@test.local`;
  created.push(fresh);
  const proc = Bun.spawn(['bun', '-e', PROBE], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      AUTH_DISABLE_SIGNUP: 'false',
      GOOGLE_CLIENT_ID: 'test-google-client',
      GOOGLE_CLIENT_SECRET: 'test-google-secret',
      ...env,
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

async function setAuth(emailAuthEnabled: boolean, signupEnabled: boolean): Promise<void> {
  await upsertSettingsRow({ emailAuthEnabled, signupEnabled });
}

function post(p: string, body: Record<string, string>): Promise<Response> {
  return api.handle(
    new Request(`http://localhost/api/auth/${p}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

beforeAll(async () => {
  invalidateSettingsCache();
  original = await readSettingsRow();
  await setAuth(true, true);
  const res = await post('sign-up/email', { email: EXISTING, password: PASSWORD, name: 'Existing' });
  expect(res.status).toBe(200);
});

afterAll(async () => {
  await db.delete(user).where(inArray(user.email, created));
  if (original) await setAuth(original.emailAuthEnabled, original.signupEnabled);
  else await db.delete(appSetting).where(eq(appSetting.id, SINGLETON_ID));
  invalidateSettingsCache();
});

describe('AUTH_DISABLE_SIGNUP parsing', () => {
  const parse = (v: string | undefined) => EnvSchema.shape.AUTH_DISABLE_SIGNUP.parse(v);

  test('empty or blank means unset', () => {
    expect(parse('')).toBeUndefined();
    expect(parse('  ')).toBeUndefined();
    expect(parse(undefined)).toBeUndefined();
  });

  test('true/false pass, anything else fails', () => {
    expect(parse('true')).toBe('true');
    expect(parse('false')).toBe('false');
    expect(() => parse('yes')).toThrow();
  });

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

describe('resolveEmailAuthGate', () => {
  const on = { emailAuthEnabled: true, signupEnabled: true };
  const google = { googleConfigured: true, signupClosedByEnv: false };

  test('everything on → sign-in and sign-up open', () => {
    expect(resolveEmailAuthGate(on, google)).toEqual({ signIn: true, signUp: true });
  });

  test('email off with Google configured → both closed', () => {
    expect(resolveEmailAuthGate({ ...on, emailAuthEnabled: false }, google)).toEqual({
      signIn: false,
      signUp: false,
    });
  });

  test('email off without Google → still open (only login method)', () => {
    const gate = resolveEmailAuthGate(
      { ...on, emailAuthEnabled: false },
      { ...google, googleConfigured: false },
    );
    expect(gate).toEqual({ signIn: true, signUp: true });
  });

  test('sign-up closed by DB toggle or env, sign-in unaffected', () => {
    expect(resolveEmailAuthGate({ ...on, signupEnabled: false }, google)).toEqual({
      signIn: true,
      signUp: false,
    });
    expect(resolveEmailAuthGate(on, { ...google, signupClosedByEnv: true })).toEqual({
      signIn: true,
      signUp: false,
    });
  });
});

describe('DB signupEnabled=false (in-process)', () => {
  test('sign-up → 403 SIGNUP_DISABLED with Indonesian message; sign-in still 200', async () => {
    await setAuth(true, false);
    try {
      const fresh = `signup-blocked-${crypto.randomUUID()}@test.local`;
      created.push(fresh);
      const up = await post('sign-up/email', { email: fresh, password: PASSWORD, name: 'X' });
      expect(up.status).toBe(403);
      const body = await up.json();
      expect(body.code).toBe('SIGNUP_DISABLED');
      expect(body.message).toBe(AUTH_GATE_ERRORS.SIGNUP_DISABLED);
      const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, fresh));
      expect(row).toBeUndefined();
      const inn = await post('sign-in/email', { email: EXISTING, password: PASSWORD });
      expect(inn.status).toBe(200);
    } finally {
      await setAuth(true, true);
    }
  });
});

describe('env + Google wiring (child process)', () => {
  test('AUTH_DISABLE_SIGNUP=true → sign-up 403, existing user can still sign in', async () => {
    const r = await probe({ AUTH_DISABLE_SIGNUP: 'true' });
    expect(r).toMatchObject({ signUp: 403, signUpCode: 'SIGNUP_DISABLED', signIn: 200 });
  }, 30_000);

  test('AUTH_DISABLE_SIGNUP=false + settings on → sign-up and sign-in work', async () => {
    const r = await probe({});
    expect(r).toMatchObject({ signUp: 200, signIn: 200 });
  }, 30_000);

  test('Google configured + emailAuthEnabled=false → email sign-in and sign-up 403', async () => {
    await setAuth(false, true);
    try {
      const r = await probe({});
      expect(r).toMatchObject({
        signIn: 403,
        signInCode: 'EMAIL_AUTH_DISABLED',
        signUp: 403,
        signUpCode: 'SIGNUP_DISABLED',
      });
    } finally {
      await setAuth(true, true);
    }
  }, 30_000);

  test('no Google + emailAuthEnabled=false → email sign-in stays available', async () => {
    await setAuth(false, true);
    try {
      const r = await probe({ GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' });
      expect(r).toMatchObject({ signIn: 200, signUp: 200 });
    } finally {
      await setAuth(true, true);
    }
  }, 30_000);
});
