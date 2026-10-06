/** GET /api/v1/openapi.json: auth (any key or session), document shape, drift guard against the real router, enums == source constants. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import pkg from '../../package.json';
import { api } from '../../server/api';
import { createKey } from '../../server/api-keys/service';
import { flushUsage } from '../../server/api-keys/usage';
import { SPEECH_FORMATS } from '../../server/audio/encode';
import { db } from '../../server/db';
import { user } from '../../server/db/schema';
import { setEngines } from '../../server/engines/registry';
import { TTS_LANGUAGES } from '../../server/engines/tts/text';
import { NATIVE_VOICES, VOICE_ALIASES } from '../../server/v1/aliases';
import { STT_MODELS, TTS_MODELS } from '../../server/v1/openapi.doc';
import { SPEED_MAX, SPEED_MIN } from '../../server/v1/speech-params';
import { GRANULARITIES, RESPONSE_FORMATS } from '../../server/v1/transcriptions.form';
import { call, fakeStt, SESSION_TOKEN, stubSession } from './fake-stt';

type Schema = {
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  oneOf?: Schema[];
  items?: Schema;
};
type Op = {
  security?: Record<string, string[]>[];
  requestBody?: { content: Record<string, { schema: { properties: Record<string, Schema> } }> };
};
type Spec = {
  openapi: string;
  info: { title: string; version: string };
  servers: { url: string }[];
  paths: Record<string, Record<string, Op>>;
  components: { securitySchemes: Record<string, { type: string; scheme: string }> };
};

const SPEC = '/api/v1/openapi.json';
const TAG = `oa-${crypto.randomUUID().slice(0, 8)}`;
const ownerId = `${TAG}-owner`;
let rawKey = '';
let spies: { mockRestore(): void }[] = [];

beforeAll(async () => {
  spies = stubSession();
  setEngines({ stt: fakeStt });
  await db.insert(user).values({
    id: ownerId,
    name: 'OpenAPI Owner',
    email: `${ownerId}@test.local`,
    emailVerified: true,
    role: 'user',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  // A scope unrelated to /api/v1: the spec needs any valid key, not a specific scope.
  rawKey = (
    await createKey({
      name: `${TAG}-key`,
      ownerId,
      scopes: ['me:read'],
      expiresDays: 1,
      rateLimitMax: null,
      rateLimitWindowMs: null,
      allowedIps: null,
      note: null,
    })
  ).key;
});
afterAll(async () => {
  for (const s of spies) s.mockRestore();
  setEngines({ stt: null });
  await Bun.sleep(20);
  await flushUsage();
  await db.delete(user).where(eq(user.id, ownerId));
});

const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });
let cached: Spec | null = null;
async function spec(): Promise<Spec> {
  if (cached) return cached;
  const res = await call(SPEC, bearer(rawKey));
  expect(res.status).toBe(200);
  cached = (await res.json()) as Spec;
  return cached;
}
const ops = (s: Spec) =>
  Object.entries(s.paths).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, op]) => ({ path, method: method.toUpperCase(), op })),
  );

describe('auth', () => {
  test('anonymous is an OpenAI-shaped 401', async () => {
    const res = await call(SPEC);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: Record<string, unknown> };
    expect(Object.keys(body)).toEqual(['error']);
    expect(body.error).toMatchObject({ type: 'authentication_error', code: 'invalid_api_key' });
  });

  test('a real key without any v1 scope gets the spec', async () => {
    expect((await spec()).openapi).toMatch(/^3\./);
  });

  test('a signed-in session gets the spec', async () => {
    expect((await call(SPEC, bearer(SESSION_TOKEN))).status).toBe(200);
  });

  test('an invalid key is 401', async () => {
    expect((await call(SPEC, bearer('mk_live_definitely_not_a_key'))).status).toBe(401);
  });

  test('there is no docs UI route', async () => {
    expect((await call('/api/v1/openapi', bearer(SESSION_TOKEN))).status).toBe(404);
  });
});

describe('document', () => {
  test('info, servers and bearer security on every operation', async () => {
    const s = await spec();
    expect(s.info).toMatchObject({ title: 'st4s API', version: pkg.version });
    expect(s.servers).toEqual([{ url: '/' }]);
    expect(s.components.securitySchemes.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
    for (const { path, method, op } of ops(s))
      expect({ path, method, bearer: op.security?.some((r) => 'bearerAuth' in r) }).toEqual({
        path,
        method,
        bearer: true,
      });
  });

  test('drift guard: spec operations == registered /api/v1 HTTP routes', async () => {
    const registered = api.routes
      .filter((r) => r.path.startsWith('/api/v1/') && r.path !== SPEC)
      .map((r) => `${r.method} ${r.path}`)
      .sort();
    const documented = ops(await spec())
      .map(({ path, method }) => `${method} ${path.replace(/\{(\w+)\}/g, ':$1')}`)
      .sort();
    expect(documented).toEqual(registered);
    expect(registered.length).toBeGreaterThanOrEqual(7);
  });

  test('enums come from the source constants', async () => {
    const s = await spec();
    const speech =
      s.paths['/api/v1/audio/speech'].post.requestBody?.content['application/json'].schema
        .properties;
    const stt =
      s.paths['/api/v1/audio/transcriptions'].post.requestBody?.content['multipart/form-data']
        .schema.properties;
    expect(speech?.model.enum).toEqual(TTS_MODELS);
    expect(speech?.response_format.enum).toEqual([...SPEECH_FORMATS]);
    expect(speech?.language.enum).toEqual([...TTS_LANGUAGES]);
    expect(speech?.voice.oneOf?.[0].enum).toEqual([
      ...NATIVE_VOICES,
      ...Object.keys(VOICE_ALIASES),
    ]);
    expect([speech?.speed.minimum, speech?.speed.maximum]).toEqual([SPEED_MIN, SPEED_MAX]);
    expect(stt?.model.enum).toEqual(STT_MODELS);
    expect(stt?.response_format.enum).toEqual([...RESPONSE_FORMATS]);
    expect(stt?.['timestamp_granularities[]'].items?.enum).toEqual(GRANULARITIES);
  });
});

test('transcriptions still refuses an oversized upload before reading the body', async () => {
  let pulled = false;
  const body = new ReadableStream(
    {
      pull() {
        pulled = true;
        throw new Error('body must not be read');
      },
    },
    // highWaterMark 0: pull runs only when someone actually reads the body.
    { highWaterMark: 0 },
  );
  const res = await call('/api/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${SESSION_TOKEN}`,
      'content-type': 'multipart/form-data; boundary=x',
      'content-length': String(1024 ** 3),
    },
    body,
  });
  expect(res.status).toBe(413);
  expect(pulled).toBe(false);
});
