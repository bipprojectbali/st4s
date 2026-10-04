/** API key refusals answer stable public codes on every path (v1 HTTP, realtime upgrade, non-v1); no Better Auth code leaks. */
import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { api } from '../../server/api';
import type { Scope } from '../../server/api-keys/scopes';
import { createKey } from '../../server/api-keys/service';
import { auth } from '../../server/auth';
import { db } from '../../server/db';
import { apikey, user } from '../../server/db/schema';
import { logger } from '../../server/logger';
import { upgradeRequest } from '../v1/realtime-harness';

const TAG = `errcode-${crypto.randomUUID().slice(0, 8)}`;
const ownerId = `${TAG}-user`;
const warnSpy = spyOn(logger, 'warn');
const keys: Record<string, { key: string; id: string }> = {};
const LEAKED = /key_not_found|key_expired|key_disabled|key_revoked|usage_exceeded|rate_limited/i;
let ip = 0;

const k = (name: string) => {
  const found = keys[name];
  if (!found) throw new Error(`test key ${name} was not created in beforeAll`);
  return found;
};

/** Distinct client IP per call so the per-IP rate limiter never interferes. */
const call = (path: string, key: string, method = 'POST') =>
  api.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        'x-api-key': key,
        'x-request-id': `${TAG}-rid`,
        'x-forwarded-for': `198.51.100.${++ip % 250}`,
        'content-type': 'application/json',
      },
      ...(method === 'POST' ? { body: JSON.stringify({ input: 'x', voice: 'F1' }) } : {}),
    }),
  );
const speech = (key: string) => call('/api/v1/audio/speech', key);

const refusal = () =>
  warnSpy.mock.calls.find((c) => c[1] === 'api key refused')?.[0] as
    | Record<string, unknown>
    | undefined;

/** Asserts the OpenAI error shape and returns the body text for leak checks. */
async function expectV1(res: Response, status: number, code: string, type: string) {
  expect(res.status).toBe(status);
  const text = await res.text();
  const body = JSON.parse(text);
  expect(Object.keys(body)).toEqual(['error']);
  expect(body.error).toMatchObject({ type, code, param: null });
  expect(typeof body.error.message).toBe('string');
  expect(res.headers.get('x-request-id')).toBe(`${TAG}-rid`);
  expect(text).not.toMatch(LEAKED);
  return body.error.message as string;
}

beforeAll(async () => {
  await db.insert(user).values({
    id: ownerId,
    name: 'Error Code User',
    email: `${ownerId}@test.local`,
    emailVerified: true,
    role: 'user',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const scoped: Record<'tts' | 'noscope', Scope[]> = {
    tts: ['tts:speak', 'stt:transcribe', 'me:read'],
    noscope: ['me:read'],
  };
  // Better Auth deletes an expired/exhausted key on its first refusal, so each path gets its own key.
  const names = [
    'expired',
    'expiredRt',
    'expiredWeb',
    'disabled',
    'revoked',
    'quota',
    'limited',
    'limited2',
    'noscope',
  ];
  for (const name of names) {
    const created = await createKey({
      name: `${TAG}-${name}`,
      ownerId,
      scopes: name === 'noscope' ? scoped.noscope : scoped.tts,
      expiresDays: 7,
      rateLimitMax: name.startsWith('limited') ? 1 : null,
      rateLimitWindowMs: name.startsWith('limited') ? 60_000 : null,
      allowedIps: null,
      note: null,
    });
    keys[name] = { key: created.key, id: created.row.id };
  }
  const past = new Date(Date.now() - 60_000);
  const set = (name: string, values: Partial<typeof apikey.$inferInsert>) =>
    db
      .update(apikey)
      .set(values)
      .where(eq(apikey.id, k(name).id));
  for (const name of ['expired', 'expiredRt', 'expiredWeb']) await set(name, { expiresAt: past });
  await set('disabled', { enabled: false });
  await set('revoked', { revokedAt: past });
  await set('quota', { remaining: 0 });
  // One request already spent in the current 60 s window → the next one is rate limited.
  for (const name of ['limited', 'limited2'])
    await set(name, { requestCount: 1, lastRequest: new Date() });
});

beforeEach(() => warnSpy.mockClear());

afterAll(async () => {
  warnSpy.mockRestore();
  await db.delete(apikey).where(eq(apikey.referenceId, ownerId));
  await db.delete(user).where(eq(user.id, ownerId));
});

describe('/api/v1 API key refusal codes', () => {
  test('unknown key → 401 invalid_api_key', async () => {
    await expectV1(
      await speech('mk_live_DoesNotExist0123456789abcdefgh'),
      401,
      'invalid_api_key',
      'authentication_error',
    );
    expect(refusal()).toMatchObject({ code: 'INVALID_API_KEY', rawCode: 'INVALID_API_KEY' });
  });

  test('expired key → 401 invalid_api_key with an actionable message', async () => {
    const msg = await expectV1(
      await speech(k('expired').key),
      401,
      'invalid_api_key',
      'authentication_error',
    );
    expect(msg).toContain('kedaluwarsa');
    expect(refusal()).toMatchObject({ rawCode: 'KEY_EXPIRED' });
  });

  test('disabled and revoked keys → 401 invalid_api_key', async () => {
    for (const [name, raw] of [
      ['disabled', 'KEY_DISABLED'],
      ['revoked', 'KEY_REVOKED'],
    ] as const) {
      warnSpy.mockClear();
      await expectV1(await speech(k(name).key), 401, 'invalid_api_key', 'authentication_error');
      expect(refusal()).toMatchObject({ code: 'INVALID_API_KEY', rawCode: raw });
    }
  });

  test('usage limit reached → 429 insufficient_quota', async () => {
    const msg = await expectV1(
      await speech(k('quota').key),
      429,
      'insufficient_quota',
      'rate_limit_error',
    );
    expect(msg).toContain('Kuota');
    expect(refusal()).toMatchObject({ rawCode: 'USAGE_EXCEEDED' });
  });

  test('per-key rate limit → 429 rate_limit_exceeded with Retry-After', async () => {
    const res = await speech(k('limited').key);
    await expectV1(res, 429, 'rate_limit_exceeded', 'rate_limit_error');
    const retry = Number(res.headers.get('retry-after'));
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(60);
    expect(refusal()).toMatchObject({ rawCode: 'RATE_LIMITED' });
  });

  test('missing scope stays 403 missing_scope', async () => {
    await expectV1(await speech(k('noscope').key), 403, 'missing_scope', 'permission_error');
  });

  test('an unknown Better Auth code → 401 invalid_api_key, raw code only in the log', async () => {
    const verify = spyOn(auth.api, 'verifyApiKey').mockResolvedValueOnce({
      valid: false,
      error: { code: 'SOME_FUTURE_CODE', message: 'library message' },
      key: null,
    } as unknown as Awaited<ReturnType<typeof auth.api.verifyApiKey>>);
    try {
      const res = await speech('mk_live_StubbedVerify0123456789abcdefg');
      const msg = await expectV1(res, 401, 'invalid_api_key', 'authentication_error');
      expect(msg).not.toContain('library message');
      expect(refusal()).toMatchObject({
        requestId: `${TAG}-rid`,
        code: 'INVALID_API_KEY',
        rawCode: 'SOME_FUTURE_CODE',
      });
    } finally {
      verify.mockRestore();
    }
  });
});

describe('other paths share the same codes', () => {
  test('realtime upgrade with an expired key → 401 invalid_api_key', async () => {
    const res = await upgradeRequest({ 'x-api-key': k('expiredRt').key });
    if (!res) throw new Error('realtime upgrade returned no response');
    expect(res.status).toBe(401);
    const text = await res.text();
    expect(JSON.parse(text).error).toMatchObject({
      code: 'invalid_api_key',
      type: 'authentication_error',
    });
    expect(text).not.toMatch(LEAKED);
  });

  test('non-v1 /api/* keeps its body shape with the upper-case code', async () => {
    const res = await call('/api/me/logins', k('expiredWeb').key, 'GET');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: 'API key kedaluwarsa. Buat API key baru.',
      code: 'INVALID_API_KEY',
      status: 401,
      requestId: `${TAG}-rid`,
    });
    const limited = await call('/api/me/logins', k('limited2').key, 'GET');
    expect(limited.status).toBe(429);
    expect((await limited.json()).code).toBe('RATE_LIMIT_EXCEEDED');
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});
