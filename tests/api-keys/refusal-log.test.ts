/** Every API key refusal writes exactly one `api key refused` warn with its code and no key material. */
import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import Elysia from 'elysia';
import { meApi } from '../../server/api/me';
import { apiKeyPlugin } from '../../server/api-keys/plugin';
import { createKey } from '../../server/api-keys/service';
import { db } from '../../server/db';
import { apikey, user } from '../../server/db/schema';
import { logger } from '../../server/logger';

const TAG = `refuse-${crypto.randomUUID().slice(0, 8)}`;
const ownerId = `${TAG}-user`;
const app = new Elysia({ prefix: '/api' }).use(apiKeyPlugin()).use(meApi);
const warnSpy = spyOn(logger, 'warn');
const keys: Record<string, { key: string; id: string }> = {};

const newKey = async (name: string) => {
  const k = await createKey({
    name: `${TAG}-${name}`,
    ownerId,
    scopes: ['me:read'],
    expiresDays: 7,
    rateLimitMax: null,
    rateLimitWindowMs: null,
    allowedIps: null,
    note: null,
  });
  keys[name] = { key: k.key, id: k.row.id };
};

const k = (name: string) => {
  const found = keys[name];
  if (!found) throw new Error(`test key ${name} was not created in beforeAll`);
  return found;
};

const call = (path: string, key: string, method = 'GET') =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { 'x-api-key': key, 'x-request-id': `${TAG}-rid`, 'x-forwarded-for': '203.0.113.9' },
    }),
  );

const refusals = () => warnSpy.mock.calls.filter((c) => c[1] === 'api key refused');

/** Asserts one refusal line with the expected fields and that no part of the key secret leaks. */
function expectOneRefusal(key: string, fields: Record<string, unknown>) {
  const lines = refusals();
  expect(lines.length).toBe(1);
  expect(lines[0]?.[0]).toMatchObject({ requestId: `${TAG}-rid`, ...fields });
  const serialized = JSON.stringify(lines[0]);
  expect(serialized).not.toContain(key);
  expect(serialized).not.toContain(key.slice('mk_live_'.length, 'mk_live_'.length + 6));
}

beforeAll(async () => {
  await db.insert(user).values({
    id: ownerId,
    name: 'Refusal User',
    email: `${ownerId}@test.local`,
    emailVerified: true,
    role: 'user',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  for (const name of ['ok', 'expired', 'disabled', 'revoked', 'ip']) await newKey(name);
  const past = new Date(Date.now() - 60_000);
  await db
    .update(apikey)
    .set({ expiresAt: past })
    .where(eq(apikey.id, k('expired').id));
  await db
    .update(apikey)
    .set({ enabled: false })
    .where(eq(apikey.id, k('disabled').id));
  await db
    .update(apikey)
    .set({ revokedAt: past })
    .where(eq(apikey.id, k('revoked').id));
  await db
    .update(apikey)
    .set({ allowedIps: '10.0.0.' })
    .where(eq(apikey.id, k('ip').id));
});

beforeEach(() => warnSpy.mockClear());

afterAll(async () => {
  warnSpy.mockRestore();
  await db.delete(apikey).where(eq(apikey.referenceId, ownerId));
  await db.delete(user).where(eq(user.id, ownerId));
});

describe('api key refusal logging', () => {
  test('a valid key logs no refusal', async () => {
    expect((await call('/api/me/logins', k('ok').key)).status).toBe(200);
    expect(refusals().length).toBe(0);
  });

  test('endpoint closed to API keys → 403, logged without key id (not verified yet)', async () => {
    const res = await call('/api/me/api-keys', k('ok').key);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'Endpoint ini tidak bisa diakses dengan API key',
      code: 'ENDPOINT_NOT_ALLOWED',
      status: 403,
      requestId: `${TAG}-rid`,
    });
    expect(res.headers.get('x-request-id')).toBe(`${TAG}-rid`);
    expectOneRefusal(k('ok').key, {
      code: 'ENDPOINT_NOT_ALLOWED',
      status: 403,
      path: '/api/me/api-keys',
    });
    expect(refusals()[0]?.[0]).not.toHaveProperty('keyId');
  });

  test('unknown key → 401, logged without any key info', async () => {
    const fake = 'mk_live_ThisKeyDoesNotExist0123456789ab';
    const res = await call('/api/me/logins', fake);
    expect(res.status).toBe(401);
    const code = (await res.json()).code;
    expectOneRefusal(fake, { code, status: 401, path: '/api/me/logins' });
    expect(refusals()[0]?.[0]).not.toHaveProperty('keyId');
  });

  test('expired, disabled, revoked and IP-blocked keys each log their code and reason', async () => {
    const cases = [
      ['expired', 401, 'INVALID_API_KEY', 'KEY_EXPIRED'],
      ['disabled', 401, 'INVALID_API_KEY', 'KEY_DISABLED'],
      ['revoked', 401, 'INVALID_API_KEY', 'KEY_REVOKED'],
      ['ip', 403, 'IP_NOT_ALLOWED', null],
    ] as const;
    for (const [name, status, code, rawCode] of cases) {
      warnSpy.mockClear();
      const res = await call('/api/me/logins', k(name).key);
      expect(res.status).toBe(status);
      expect((await res.json()).code).toBe(code);
      expectOneRefusal(k(name).key, {
        code,
        status,
        path: '/api/me/logins',
        ...(rawCode ? { rawCode } : {}),
      });
      // Expired/disabled fail inside Better Auth before the key id is known.
      if (name === 'revoked' || name === 'ip')
        expect(refusals()[0]?.[0]).toMatchObject({ keyId: k(name).id });
    }
  });

  test('missing scope → 403 MISSING_SCOPE with scope and key id', async () => {
    const res = await call('/api/v1/audio/transcriptions', k('ok').key, 'POST');
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('missing_scope');
    expectOneRefusal(k('ok').key, {
      code: 'MISSING_SCOPE',
      status: 403,
      path: '/api/v1/audio/transcriptions',
      scope: 'stt:transcribe',
      keyId: k('ok').id,
    });
  });

  test('/api/v1 keeps the OpenAI error shape for an invalid key', async () => {
    const fake = 'mk_live_AnotherMissingKey0123456789abcd';
    const res = await call('/api/v1/audio/transcriptions', fake, 'POST');
    expect(res.status).toBe(401);
    expect((await res.json()).error.type).toBe('authentication_error');
    expectOneRefusal(fake, { status: 401, path: '/api/v1/audio/transcriptions' });
    expect(res.headers.get('x-request-id')).toBe(`${TAG}-rid`);
  });

  test('a generated requestId reaches both the log line and the response', async () => {
    const fake = 'mk_live_NoRequestIdHeader0123456789abcd';
    for (const path of ['/api/me/logins', '/api/v1/audio/transcriptions']) {
      warnSpy.mockClear();
      const res = await app.handle(
        new Request(`http://localhost${path}`, {
          method: path.includes('/v1/') ? 'POST' : 'GET',
          headers: { 'x-api-key': fake },
        }),
      );
      expect(res.status).toBe(401);
      const logged = (refusals()[0]?.[0] as { requestId?: string } | undefined)?.requestId;
      expect(logged).toMatch(/^[0-9a-f-]{12}$/);
      expect(res.headers.get('x-request-id')).toBe(logged ?? null);
      const body = await res.json();
      if (!path.includes('/v1/')) expect(body.requestId).toBe(logged);
    }
  });
});
