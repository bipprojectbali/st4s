/**
 * Closed sign-up also covers Google: the pure rule, and the real OAuth callback
 * (Google token endpoint stubbed) in a child process so AUTH_DISABLE_SIGNUP and
 * SUPER_ADMIN_EMAILS can be set before server/auth.ts reads env.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import path from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../server/db';
import { appSetting, user } from '../server/db/schema';
import {
  invalidateSettingsCache,
  readSettingsRow,
  type SettingsRow,
  SINGLETON_ID,
  upsertSettingsRow,
} from '../server/settings.core';
import { maySocialSignUp } from '../server/settings-auth';

const ROOT = path.join(import.meta.dir, '..');
const tag = crypto.randomUUID().slice(0, 8);
const OWNER = `owner-${tag}@test.local`;
const EXISTING = `google-existing-${tag}@test.local`;
const created: string[] = [OWNER, EXISTING];

let original: SettingsRow | null = null;

type Result = { status: number; location: string; userCreated: boolean };

// Runs sign-in/social → callback/google with the token exchange stubbed; prints one JSON line.
const PROBE = `
const realFetch = globalThis.fetch;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const email = process.env.PROBE_EMAIL;
const idToken = b64({ alg: 'none', typ: 'JWT' }) + '.' + b64({
  iss: 'https://accounts.google.com', aud: process.env.GOOGLE_CLIENT_ID, sub: 'sub-' + email,
  email, email_verified: true, name: 'Probe', iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 600,
}) + '.';
globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url.startsWith('https://oauth2.googleapis.com/token')) {
    return Response.json({ access_token: 'at', id_token: idToken, expires_in: 3600, token_type: 'Bearer', scope: 'openid email profile' });
  }
  return realFetch(input, init);
};
const { api } = await import('./server/api');
const { db } = await import('./server/db');
const { user } = await import('./server/db/schema');
const { eq } = await import('drizzle-orm');
const start = await api.handle(new Request('http://localhost/api/auth/sign-in/social', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ provider: 'google', callbackURL: '/go', errorCallbackURL: '/login' }),
}));
const { url } = await start.json();
const state = new URL(url).searchParams.get('state');
const cookie = start.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const cb = await api.handle(new Request('http://localhost/api/auth/callback/google?code=fake&state=' + state, { headers: { cookie } }));
const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, email.toLowerCase()));
console.log(JSON.stringify({ status: cb.status, location: cb.headers.get('location') ?? '', userCreated: Boolean(row) }));
process.exit(0);
`;

async function probe(email: string, signupClosed: boolean): Promise<Result> {
  created.push(email.toLowerCase());
  const proc = Bun.spawn(['bun', '-e', PROBE], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      AUTH_DISABLE_SIGNUP: signupClosed ? 'true' : 'false',
      GOOGLE_CLIENT_ID: 'test-google-client', // test-only
      GOOGLE_CLIENT_SECRET: 'test-google-secret', // test-only
      SUPER_ADMIN_EMAILS: `other@test.local, ${OWNER}`,
      PROBE_EMAIL: email,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (code !== 0)
    throw new Error(`oauth probe exited ${code}: ${await new Response(proc.stderr).text()}`);
  const line = out
    .trim()
    .split('\n')
    .reverse()
    .find((l) => l.startsWith('{"status"'));
  if (!line) throw new Error(`oauth probe printed no result: ${out.slice(-500)}`);
  return JSON.parse(line);
}

beforeAll(async () => {
  invalidateSettingsCache();
  original = await readSettingsRow();
  // Only the env switch is under test here; keep the DB toggle open.
  await upsertSettingsRow({ signupEnabled: true });
  await db.insert(user).values({
    id: `google-existing-${tag}`,
    name: 'Existing',
    email: EXISTING,
    emailVerified: true,
  });
});

afterAll(async () => {
  await db.delete(user).where(inArray(user.email, created));
  if (original) await upsertSettingsRow({ signupEnabled: original.signupEnabled });
  else await db.delete(appSetting).where(eq(appSetting.id, SINGLETON_ID));
  invalidateSettingsCache();
});

describe('maySocialSignUp', () => {
  const owners: ReadonlySet<string> = new Set(['owner@example.com']);

  test('sign-up closed + email not listed → reject', () => {
    expect(
      maySocialSignUp('stranger@example.com', { signupOpen: false, ownerEmails: owners }),
    ).toBe(false);
  });

  test('sign-up closed + listed email → allow, case-insensitive and trimmed', () => {
    expect(maySocialSignUp('owner@example.com', { signupOpen: false, ownerEmails: owners })).toBe(
      true,
    );
    expect(maySocialSignUp(' Owner@Example.COM ', { signupOpen: false, ownerEmails: owners })).toBe(
      true,
    );
  });

  test('sign-up open → anyone may sign up', () => {
    expect(
      maySocialSignUp('stranger@example.com', { signupOpen: true, ownerEmails: new Set() }),
    ).toBe(true);
  });
});

describe('Google OAuth callback with sign-up closed (child process)', () => {
  test('new stranger → back to /login?error=signup_disabled, no user row', async () => {
    const r = await probe(`stranger-${tag}@test.local`, true);
    expect(r.status).toBe(302);
    const loc = new URL(r.location, 'http://x');
    expect(loc.pathname).toBe('/login');
    expect(loc.searchParams.get('error')).toBe('signup_disabled');
    expect(r.userCreated).toBe(false);
  }, 30_000);

  test('owner listed in SUPER_ADMIN_EMAILS (any case) → account created, lands on /go', async () => {
    const r = await probe(OWNER.toUpperCase(), true);
    expect(r.status).toBe(302);
    expect(r.location).toStartWith('/go');
    expect(r.userCreated).toBe(true);
  }, 30_000);

  test('existing verified user → linked and signed in, lands on /go', async () => {
    const r = await probe(EXISTING, true);
    expect(r.status).toBe(302);
    expect(r.location).toStartWith('/go');
  }, 30_000);

  test('sign-up open → stranger account created', async () => {
    const r = await probe(`open-${tag}@test.local`, false);
    expect(r.location).toStartWith('/go');
    expect(r.userCreated).toBe(true);
  }, 30_000);
});
