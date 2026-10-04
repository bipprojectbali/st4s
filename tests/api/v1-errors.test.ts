/** /api/v1 errors use OpenAI's shape from every layer (router, validation, 500, api-key, rate limit, maintenance); other /api paths keep the template shape. */
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { Elysia, t } from 'elysia';
import { apiErrorPlugin } from '../../server/api-error';
import { setApiKeyIdentity } from '../../server/api-keys/identity';
import { maintenancePlugin } from '../../server/middleware/maintenance';
import { RateLimiter, rateLimitPlugin } from '../../server/middleware/rate-limiter';
import * as maintenanceMod from '../../server/settings-maintenance';
import { STT_MODEL_ID } from '../../server/v1/aliases';
import { v1Api } from '../../server/v1';
import { call, stubSession, withIp } from '../v1/fake-stt';

type V1Error = { error: { message: string; type: string; param: string | null; code: string | null } };
const json = async (res: Response) => (await res.json()) as Record<string, unknown>;
const expectV1 = async (res: Response, status: number, type: string, code?: string | null) => {
  expect(res.status).toBe(status);
  expect(res.headers.get('content-type')).toContain('application/json');
  const body = (await res.json()) as V1Error;
  expect(Object.keys(body)).toEqual(['error']);
  expect(body.error.type).toBe(type);
  expect(body.error).toHaveProperty('param');
  if (code !== undefined) expect(body.error.code).toBe(code);
  return body.error;
};

let spies: { mockRestore(): void }[] = [];
beforeAll(() => {
  spies = stubSession();
});
afterAll(() => {
  for (const s of spies) s.mockRestore();
});

describe('full app', () => {
  test('unknown /api/v1 path is OpenAI 404 with x-request-id', async () => {
    const res = await call('/api/v1/nope');
    expect(res.headers.get('x-request-id')).toBeTruthy();
    const err = await expectV1(res, 404, 'not_found_error', 'not_found');
    expect(err.message).toBe('Invalid URL (GET /api/v1/nope)');
  });

  test('non-v1 /api errors keep the template shape', async () => {
    const res = await call('/api/nope');
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body).toMatchObject({ code: 'NOT_FOUND', status: 404, path: '/api/nope' });
    expect(typeof body.requestId).toBe('string');
  });

  test('protected route without credentials is OpenAI 401', async () => {
    const res = await call('/api/v1/audio/transcriptions', { method: 'POST', body: new FormData() });
    await expectV1(res, 401, 'authentication_error', 'invalid_api_key');
  });

  test('an invalid mk_live key is OpenAI 401 from the api-key plugin', async () => {
    const res = await call('/api/v1/audio/transcriptions', {
      method: 'POST',
      headers: { authorization: 'Bearer mk_live_definitely_not_a_key' },
      body: new FormData(),
    });
    const err = await expectV1(res, 401, 'authentication_error');
    expect(err.code).toMatch(/^[a-z_]+$/);
  });

  test('an api-key identity passes the v1 auth gate', async () => {
    const req = new Request('http://localhost/api/v1/audio/translations', withIp({ method: 'POST', body: new FormData() }));
    setApiKeyIdentity(req, {
      keyId: 'k',
      keyName: 'k',
      scopes: ['stt:transcribe'],
      user: { id: 'u', email: 'u@test.local', name: 'u' },
      role: 'user',
      startedAt: 0,
    });
    const { api } = await import('../../server/api');
    await expectV1(await api.handle(req), 400, 'invalid_request_error', 'unsupported');
  });

  test('models list, single model, 404 model and voices are public', async () => {
    const list = await json(await call('/api/v1/models'));
    expect(list.object).toBe('list');
    const ids = (list.data as { id: string; object: string; owned_by: string }[]).map((m) => m.id);
    expect(ids).toContain(STT_MODEL_ID);
    expect(ids).toContain('whisper-1');

    const one = await json(await call('/api/v1/models/whisper-1'));
    expect(one).toMatchObject({ id: 'whisper-1', object: 'model', owned_by: 's4s' });
    expect(typeof one.created).toBe('number');

    await expectV1(await call('/api/v1/models/gpt-9'), 404, 'not_found_error', 'model_not_found');

    const voices = await json(await call('/api/v1/audio/voices'));
    const data = voices.data as { id: string; voice: string }[];
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((v) => typeof v.voice === 'string')).toBe(true);
  });

  test('maintenance 503 is OpenAI-shaped with Retry-After on v1, template elsewhere', async () => {
    const gate = spyOn(maintenanceMod, 'maintenanceGate').mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: 'maintenance', message: 'Sedang perawatan' }), {
          status: 503,
          headers: { 'content-type': 'application/json', 'retry-after': '120' },
        }),
    );
    try {
      const app = new Elysia({ prefix: '/api' }).use(maintenancePlugin()).use(v1Api).get('/x', () => 'x');
      const res = await app.handle(new Request('http://localhost/api/v1/models'));
      expect(res.headers.get('retry-after')).toBe('120');
      const err = await expectV1(res, 503, 'server_error', 'maintenance');
      expect(err.message).toBe('Sedang perawatan');
      expect(await json(await app.handle(new Request('http://localhost/api/x')))).toMatchObject({ error: 'maintenance' });
    } finally {
      gate.mockRestore();
    }
  });
});

describe('plugins in isolation', () => {
  const app = new Elysia({ prefix: '/api' })
    .use(apiErrorPlugin({ exposeDetails: true }))
    .use(rateLimitPlugin(new RateLimiter({ windowMs: 60_000, limit: 1, enabled: true })))
    .post('/v1/check', ({ body }) => body, { body: t.Object({ n: t.Integer() }) })
    .get('/v1/boom', () => {
      throw new Error('internal secret detail');
    })
    .get('/v1/limited', () => 'ok')
    .get('/limited', () => 'ok');
  const hit = (path: string, init: RequestInit = {}) => app.handle(new Request(`http://localhost${path}`, withIp(init)));

  test('validation 422 becomes OpenAI 400 with param', async () => {
    const res = await hit('/api/v1/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ n: 'x' }),
    });
    expect(res.headers.get('x-request-id')).toBeTruthy();
    const err = await expectV1(res, 400, 'invalid_request_error', 'validation');
    expect(err.param).toBe('n');
  });

  test('uncaught 500 hides internals even when details are exposed elsewhere', async () => {
    const res = await hit('/api/v1/boom');
    const err = await expectV1(res, 500, 'server_error', 'server_error');
    expect(err.message).not.toContain('secret');
  });

  test('rate limit 429 is OpenAI-shaped on v1 and template elsewhere', async () => {
    const ip = { headers: { 'x-forwarded-for': '10.250.0.1' } };
    expect((await app.handle(new Request('http://localhost/api/v1/limited', ip))).status).toBe(200);
    const res = await app.handle(new Request('http://localhost/api/v1/limited', ip));
    expect(res.headers.get('retry-after')).toBeTruthy();
    await expectV1(res, 429, 'rate_limit_error', 'rate_limit_exceeded');

    const other = await app.handle(new Request('http://localhost/api/limited', ip));
    expect(other.status).toBe(429);
    expect(await json(other)).toMatchObject({ error: 'Too many requests' });
  });
});
