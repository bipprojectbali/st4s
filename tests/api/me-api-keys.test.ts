/** Personal API keys: owner-only management, role-clamped scopes, session-only access. */
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import Elysia from 'elysia';
import { MAX_PERSONAL_KEYS, meApiKeysApi } from '../../server/api/me-api-keys';
import { setApiKeyIdentity } from '../../server/api-keys/identity';
import { isAdminScope, SCOPES, type Scope } from '../../server/api-keys/scopes';
import { auth } from '../../server/auth';
import { db } from '../../server/db';
import { auditLog, user } from '../../server/db/schema';
import { ROLES } from '../../server/permissions';
import * as rolesMod from '../../server/roles';

// Real resolveActor; only the session lookup and role reconciliation are stubbed
// (a module mock of guard would leak into other test files in the same run).
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
const setActor = (a: FakeActor) => {
  ctx.actor = a;
};
const app = new Elysia().use(meApiKeysApi);
const TAG = `mek-${crypto.randomUUID().slice(0, 8)}`;
const aliceId = `${TAG}-alice`;
const bobId = `${TAG}-bob`;
const alice: FakeActor = {
  user: { id: aliceId, email: `${aliceId}@test.local` },
  role: 'user',
  viaApiKey: false,
};
const bob: FakeActor = {
  user: { id: bobId, email: `${bobId}@test.local` },
  role: 'admin',
  viaApiKey: false,
};
const json = (method: string, body?: unknown) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});
async function call(path: string, init?: RequestInit) {
  const req = new Request(`http://localhost/me/api-keys${path}`, init);
  if (ctx.actor?.viaApiKey)
    setApiKeyIdentity(req, {
      keyId: 'k',
      keyName: 'k',
      scopes: ['me:read'],
      user: { ...ctx.actor.user, name: 'x' },
      role: ctx.actor.role as 'user',
      startedAt: 0,
    });
  const res = await app.handle(req);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}
const input = (name: string, scopes: string[]) => ({
  name,
  scopes,
  expiresDays: 30,
  rateLimitMax: null,
  rateLimitWindowMs: null,
  allowedIps: null,
  note: null,
});
let aliceKeyId = '';

beforeAll(async () => {
  await db.insert(user).values(
    [
      [aliceId, 'user'],
      [bobId, 'admin'],
    ].map(([id, role]) => ({
      id,
      name: id,
      email: `${id}@test.local`,
      emailVerified: true,
      role,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  );
});
afterAll(async () => {
  for (const sp of spies) sp.mockRestore();
  await db
    .delete(auditLog)
    .where(eq(auditLog.targetType, 'apikey'))
    .catch(() => {});
  for (const id of [aliceId, bobId])
    await db
      .delete(user)
      .where(eq(user.id, id))
      .catch(() => {});
});

describe('/me/api-keys', () => {
  test('requires a session; an API key may not manage keys', async () => {
    setActor(null);
    expect((await call('/')).status).toBe(401);
    setActor({ ...alice, viaApiKey: true });
    expect((await call('/')).status).toBe(403);
  });
  test('lists only scopes the role may hold and creates a key (plain value once)', async () => {
    setActor(alice);
    const list = await call('/');
    expect(list.status).toBe(200);
    const ids = (list.body.scopes as Array<{ id: string }>).map((s) => s.id);
    // Independent of scopesForRole (which the route uses): exactly the USER-tier scopes, in catalogue order.
    expect(ids).toEqual(SCOPES.filter((s) => s.minRole === ROLES.USER).map((s) => s.id));
    expect(ids).toEqual(expect.arrayContaining(['posts:write', 'me:read']));
    expect(ids.some((id) => isAdminScope(id as Scope))).toBe(false);
    expect(list.body.max).toBe(MAX_PERSONAL_KEYS);
    const tooHigh = await call('/', json('POST', input('nope', ['users:read'])));
    expect(tooHigh.status).toBe(400);
    const forever = await call(
      '/',
      json('POST', { ...input('nope', ['me:read']), expiresDays: null }),
    );
    expect(forever.status).toBe(400);
    const ok = await call('/', json('POST', input('cli', ['me:read'])));
    expect(ok.status).toBe(200);
    expect(String(ok.body.key).startsWith('mk_live_')).toBe(true);
    const row = ok.body.row as { id: string; ownerId: string; scopes: string[] };
    expect(row.ownerId).toBe(aliceId);
    expect(row.scopes).toEqual(['me:read']);
    aliceKeyId = row.id;
    await Bun.sleep(50); // audit() is fire-and-forget
    const audit = await db.select().from(auditLog).where(eq(auditLog.targetId, aliceKeyId));
    expect(audit[0]?.actorId).toBe(aliceId);
  });
  test('other users cannot see, edit, rotate or delete the key', async () => {
    setActor(bob);
    expect((await call(`/${aliceKeyId}/usage`)).status).toBe(404);
    expect((await call(`/${aliceKeyId}`, json('PUT', { name: 'stolen' }))).status).toBe(404);
    expect((await call(`/${aliceKeyId}/rotate`, json('POST', {}))).status).toBe(404);
    expect((await call(`/${aliceKeyId}`, { method: 'DELETE' })).status).toBe(404);
  });
  test('owner can edit, read usage, rotate, revoke and delete', async () => {
    setActor(alice);
    const edited = await call(`/${aliceKeyId}`, json('PUT', { name: 'cli-2', note: 'laptop' }));
    expect(edited.status).toBe(200);
    expect(edited.body.name).toBe('cli-2');
    const usage = await call(`/${aliceKeyId}/usage`);
    expect(usage.status).toBe(200);
    expect((usage.body.summary as { total: number }).total).toBe(0);
    expect(usage.body.anomalies).toBeDefined();
    const rotated = await call(`/${aliceKeyId}/rotate`, json('POST', {}));
    expect(rotated.status).toBe(200);
    const newId = (rotated.body.row as { id: string }).id;
    expect((await call(`/${aliceKeyId}/revoke`, json('POST', {}))).status).toBe(200);
    expect((await call('/')).body.total).toBe(2);
    expect((await call(`/${newId}`, { method: 'DELETE' })).status).toBe(200);
    expect((await call(`/${aliceKeyId}`, { method: 'DELETE' })).status).toBe(200);
  });
});
