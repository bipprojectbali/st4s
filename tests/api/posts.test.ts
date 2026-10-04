import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import Elysia from 'elysia';
import { postsApi } from '../../server/api/posts';
import { auth } from '../../server/auth';
import { db } from '../../server/db';
import { auditLog, post, user } from '../../server/db/schema';
import * as rolesMod from '../../server/roles';

type Actor = { id: string; email: string } | null;
const ctx: { actor: Actor; role: string | null } = { actor: null, role: null };
const spies = [
  spyOn(auth.api, 'getSession').mockImplementation((async () =>
    ctx.actor ? { user: ctx.actor } : null) as unknown as typeof auth.api.getSession),
  spyOn(rolesMod, 'resolveUserRole').mockImplementation(async () => (ctx.role ?? 'user') as 'user'),
];
const app = new Elysia().use(postsApi);
const TAG = `post-${crypto.randomUUID().slice(0, 8)}`;
const owner = `${TAG}-owner`;
const other = `${TAG}-other`;
const admin = `${TAG}-admin`;
let postId = '';

async function req(method: string, path: string, body?: unknown) {
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
  return {
    status: res.status,
    body: (await res.json().catch(() => null)) as Record<string, unknown>,
  };
}

beforeAll(async () => {
  for (const id of [owner, other, admin]) {
    await db.insert(user).values({
      id,
      name: id,
      email: `${id}@test.local`,
      emailVerified: false,
      role: id === admin ? 'admin' : 'user',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
});
afterAll(async () => {
  for (const s of spies) s.mockRestore();
  await db
    .delete(auditLog)
    .where(inArray(auditLog.actorId, [owner, other, admin]))
    .catch(() => {});
  await db
    .delete(user)
    .where(inArray(user.id, [owner, other, admin]))
    .catch(() => {});
});

describe('posts API', () => {
  test('anonymous cannot create; owner creates and list/search/stats work', async () => {
    ctx.actor = null;
    expect((await req('POST', '/posts', { title: 'x' })).status).toBe(401);
    ctx.actor = { id: owner, email: `${owner}@test.local` };
    ctx.role = 'user';
    const created = await req('POST', '/posts', { title: `  ${TAG} Judul  `, content: 'isi' });
    expect(created.status).toBe(200);
    expect(created.body.title).toBe(`${TAG} Judul`);
    expect(created.body.authorName).toBe(owner);
    postId = created.body.id as string;
    const list = await req('GET', `/posts?search=${TAG}`);
    expect(list.body.total).toBe(1);
    expect((await req('GET', `/posts/${postId}`)).status).toBe(200);
    expect((await req('GET', '/posts/nope')).status).toBe(404);
  });

  test('another user cannot edit or delete; owner can edit', async () => {
    ctx.actor = { id: other, email: `${other}@test.local` };
    ctx.role = 'user';
    expect((await req('PUT', `/posts/${postId}`, { title: 'hack' })).status).toBe(403);
    expect((await req('DELETE', `/posts/${postId}`)).status).toBe(403);
    ctx.actor = { id: owner, email: `${owner}@test.local` };
    const upd = await req('PUT', `/posts/${postId}`, { title: `${TAG} Diubah`, content: null });
    expect(upd.status).toBe(200);
    expect(upd.body.title).toBe(`${TAG} Diubah`);
  });

  test("admin can delete someone else's post and it is audited", async () => {
    ctx.actor = { id: admin, email: `${admin}@test.local` };
    ctx.role = 'admin';
    expect((await req('DELETE', `/posts/${postId}`)).status).toBe(200);
    expect((await req('GET', `/posts/${postId}`)).status).toBe(404);
    await new Promise((r) => setTimeout(r, 100));
    const rows = await db.select().from(auditLog).where(eq(auditLog.targetId, postId));
    expect(rows.length).toBe(1);
    expect(rows[0].action).toBe('post.delete');
    const remaining = await db.select({ id: post.id }).from(post).where(eq(post.id, postId));
    expect(remaining.length).toBe(0);
  });
});
