/** /api/engines: super-admin session only, status overview, warmup/unload with audit. */
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import Elysia from 'elysia';
import { enginesApi } from '../../server/api/engines';
import { setApiKeyIdentity } from '../../server/api-keys/identity';
import { auth } from '../../server/auth';
import { db } from '../../server/db';
import { auditLog, user } from '../../server/db/schema';
import { setEngines } from '../../server/engines/registry';
import type { EngineState, EngineStatus, SttEngine, TtsEngine } from '../../server/engines/types';
import * as rolesMod from '../../server/roles';

type FakeActor = { user: { id: string; email: string }; role: string; viaApiKey: boolean } | null;
const ctx: { actor: FakeActor } = { actor: null };
const spies = [
  spyOn(auth.api, 'getSession').mockImplementation((async () =>
    ctx.actor && !ctx.actor.viaApiKey
      ? { user: ctx.actor.user }
      : null) as unknown as typeof auth.api.getSession),
  spyOn(rolesMod, 'resolveUserRole').mockImplementation(
    async () => (ctx.actor?.role ?? 'user') as 'user',
  ),
];

const TAG = `eng-${crypto.randomUUID().slice(0, 8)}`;
const superId = `${TAG}-super`;
const superAdmin = {
  user: { id: superId, email: `${superId}@test.local` },
  role: 'super-admin',
  viaApiKey: false,
};

/** Fake engine that records calls; no model is ever loaded. */
function fakeEngine(kind: 'stt' | 'tts', failWarmup = false) {
  const calls: string[] = [];
  let state: EngineState = 'unloaded';
  const status = (): EngineStatus => ({
    kind,
    model: `${kind}-fake`,
    state,
    queued: 0,
    loadedAt: null,
    lastError: null,
    rssBytes: null,
    stats: { requests: 0, errors: 0, p50Ms: null, p95Ms: null, rtfP50: null },
  });
  const engine = {
    status,
    async warmup() {
      calls.push('warmup');
      if (failWarmup) throw new Error('model file missing');
      state = 'ready';
    },
    async unload() {
      calls.push('unload');
      state = 'unloaded';
    },
    sampleRate: 44_100,
    voices: () => ['F1', 'M1'],
  };
  return { engine, calls };
}

const g = globalThis as typeof globalThis & {
  __s4sEngines?: { stt: SttEngine | null; tts: TtsEngine | null };
};
const previous = { ...(g.__s4sEngines ?? { stt: null, tts: null }) };
const app = new Elysia().use(enginesApi);

async function call(path: string, method = 'GET') {
  const req = new Request(`http://localhost/engines${path}`, { method });
  if (ctx.actor?.viaApiKey)
    setApiKeyIdentity(req, {
      keyId: 'k',
      keyName: 'k',
      scopes: ['admin:read'],
      user: { ...ctx.actor.user, name: 'x' },
      role: ctx.actor.role as 'user',
      startedAt: 0,
    });
  const res = await app.handle(req);
  // biome-ignore lint/suspicious/noExplicitAny: test-only, assertions reach into arbitrary nested JSON
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

beforeAll(async () => {
  await db.insert(user).values({
    id: superId,
    name: superId,
    email: `${superId}@test.local`,
    emailVerified: true,
    role: 'admin',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
});
afterAll(async () => {
  for (const sp of spies) sp.mockRestore();
  setEngines(previous);
  await db.delete(auditLog).where(eq(auditLog.actorId, superId));
  await db.delete(user).where(eq(user.id, superId));
});

describe('/api/engines', () => {
  test('requires a super-admin browser session', async () => {
    ctx.actor = null;
    expect((await call('/')).status).toBe(401);
    ctx.actor = { ...superAdmin, role: 'admin' };
    expect((await call('/')).status).toBe(403);
    ctx.actor = { ...superAdmin, viaApiKey: true };
    const viaKey = await call('/stt/warmup', 'POST');
    expect(viaKey.status).toBe(403);
    expect(viaKey.body.code).toBe('API_KEY_NOT_ALLOWED');
  });

  test('GET returns both statuses; a missing engine is null, not a 500', async () => {
    ctx.actor = superAdmin;
    const tts = fakeEngine('tts');
    setEngines({ stt: null, tts: tts.engine as unknown as TtsEngine });
    const { status, body } = await call('/');
    expect(status).toBe(200);
    expect(body.stt).toBeNull();
    expect(body.tts).toMatchObject({ kind: 'tts', model: 'tts-fake', state: 'unloaded' });
    expect(body.tts_voices).toEqual(['F1', 'M1']);
    expect(body.tts_languages).toContain('id');
    expect(typeof body.stt_default_language).toBe('string');
    expect(typeof body.tts_default_language).toBe('string');
    expect(body.memory.serverRssBytes).toBeGreaterThan(0);
    expect(body.memory.totalBytes).toBeGreaterThan(0);
    expect(body.deps.map((d: { name: string }) => d.name)).toEqual([
      'CRISPASR_LIB',
      'STT_MODEL',
      'STT_VAD_MODEL',
      'STT_LID_MODEL',
      'TTS_MODEL_DIR',
      'FFMPEG_PATH',
    ]);
    for (const d of body.deps) {
      expect(typeof d.ok).toBe('boolean');
      expect(typeof d.detail).toBe('string');
    }
  });

  test('warmup and unload call through and are audited', async () => {
    ctx.actor = superAdmin;
    const stt = fakeEngine('stt');
    setEngines({ stt: stt.engine as unknown as SttEngine });
    const w = await call('/stt/warmup', 'POST');
    expect(w.status).toBe(200);
    expect(w.body.status.state).toBe('ready');
    const u = await call('/stt/unload', 'POST');
    expect(u.status).toBe(200);
    expect(u.body.status.state).toBe('unloaded');
    expect(stt.calls).toEqual(['warmup', 'unload']);
    await Bun.sleep(50);
    const rows = await db
      .select({ action: auditLog.action, targetId: auditLog.targetId })
      .from(auditLog)
      .where(and(eq(auditLog.actorId, superId), eq(auditLog.targetType, 'engine')));
    expect(rows.map((r) => r.action).sort()).toEqual(['engine.unload', 'engine.warmup']);
    expect(rows.every((r) => r.targetId === 'stt')).toBe(true);
  });

  test('bad kind is 400; unregistered or failing engine is 503 with a code', async () => {
    ctx.actor = superAdmin;
    const bad = await call('/gpu/warmup', 'POST');
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('BAD_KIND');
    setEngines({ stt: null });
    const missing = await call('/stt/warmup', 'POST');
    expect(missing.status).toBe(503);
    expect(missing.body.code).toBe('ENGINE_NOT_REGISTERED');
    const broken = fakeEngine('tts', true);
    setEngines({ tts: broken.engine as unknown as TtsEngine });
    const failed = await call('/tts/warmup', 'POST');
    expect(failed.status).toBe(503);
    expect(failed.body.code).toBe('ENGINE_WARMUP_FAILED');
    expect(failed.body.error).toContain('model file missing');
  });
});
