/**
 * Tests for resolveUserRole (server/roles.ts) — the request-path reconciler that
 * aligns a user's stored role with SUPER_ADMIN_EMAILS and persists only when the
 * role actually changes. Uses real DB rows with random emails; allowlist cases
 * add the email to the in-memory superAdminEmails set and remove it afterwards,
 * so results never depend on the ambient SUPER_ADMIN_EMAILS value.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '../server/db';
import { user } from '../server/db/schema';
import { superAdminEmails } from '../server/env';
import { ROLES } from '../server/permissions';
import { resolveUserRole } from '../server/roles';

const created: string[] = [];
const allowlisted: string[] = [];
const allowlist = superAdminEmails as Set<string>; // test-only mutation of the env-derived set

function allow(email: string): void {
  allowlist.add(email);
  allowlisted.push(email);
}

async function seedUser(
  role: string,
  emailVerified = false,
): Promise<{ id: string; email: string }> {
  const id = `roles-${crypto.randomUUID()}`;
  const email = `${id}@test.local`;
  await db.insert(user).values({
    id,
    name: id,
    email,
    emailVerified,
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  created.push(id);
  return { id, email };
}

async function storedRole(id: string): Promise<string | null> {
  const [row] = await db.select({ role: user.role }).from(user).where(eq(user.id, id)).limit(1);
  return row?.role ?? null;
}

afterEach(async () => {
  for (const e of allowlisted.splice(0)) allowlist.delete(e);
  for (const id of created.splice(0))
    await db
      .delete(user)
      .where(eq(user.id, id))
      .catch(() => {});
});

describe('resolveUserRole', () => {
  test('demotes a stale super-admin (email not in allowlist) and persists the change', async () => {
    const u = await seedUser(ROLES.SUPER_ADMIN);
    const resolved = await resolveUserRole({ id: u.id, email: u.email, role: ROLES.SUPER_ADMIN });
    expect(resolved).toBe(ROLES.USER);
    expect(await storedRole(u.id)).toBe(ROLES.USER);
  });

  test('keeps an admin role unchanged and does not rewrite it', async () => {
    const u = await seedUser(ROLES.ADMIN);
    const resolved = await resolveUserRole({ id: u.id, email: u.email, role: ROLES.ADMIN });
    expect(resolved).toBe(ROLES.ADMIN);
    expect(await storedRole(u.id)).toBe(ROLES.ADMIN);
  });

  test('normalizes an unknown stored role to user', async () => {
    const u = await seedUser('user');
    const resolved = await resolveUserRole({ id: u.id, email: u.email, role: 'legacy-editor' });
    expect(resolved).toBe(ROLES.USER);
  });

  test('does NOT grant super-admin to an unverified allowlisted email', async () => {
    const u = await seedUser(ROLES.USER, false);
    allow(u.email);
    const resolved = await resolveUserRole({
      id: u.id,
      email: u.email,
      role: ROLES.USER,
      emailVerified: false,
    });
    expect(resolved).toBe(ROLES.USER);
    expect(await storedRole(u.id)).toBe(ROLES.USER);
  });

  test('keeps the normal role (admin) of an unverified allowlisted email', async () => {
    const u = await seedUser(ROLES.ADMIN, false);
    allow(u.email);
    const resolved = await resolveUserRole({
      id: u.id,
      email: u.email,
      role: ROLES.ADMIN,
      emailVerified: false,
    });
    expect(resolved).toBe(ROLES.ADMIN);
  });

  test('grants super-admin to a verified allowlisted email and persists it', async () => {
    const u = await seedUser(ROLES.USER, true);
    allow(u.email);
    const resolved = await resolveUserRole({
      id: u.id,
      email: u.email,
      role: ROLES.USER,
      emailVerified: true,
    });
    expect(resolved).toBe(ROLES.SUPER_ADMIN);
    expect(await storedRole(u.id)).toBe(ROLES.SUPER_ADMIN);
  });

  test('demotes a stored super-admin whose allowlisted email is unverified', async () => {
    const u = await seedUser(ROLES.SUPER_ADMIN, false);
    allow(u.email);
    const resolved = await resolveUserRole({
      id: u.id,
      email: u.email,
      role: ROLES.SUPER_ADMIN,
      emailVerified: false,
    });
    expect(resolved).toBe(ROLES.USER);
    expect(await storedRole(u.id)).toBe(ROLES.USER);
  });

  test('reads emailVerified from the DB when the caller omits it', async () => {
    const verified = await seedUser(ROLES.USER, true);
    const unverified = await seedUser(ROLES.SUPER_ADMIN, false);
    allow(verified.email);
    allow(unverified.email);
    expect(
      await resolveUserRole({ id: verified.id, email: verified.email, role: ROLES.USER }),
    ).toBe(ROLES.SUPER_ADMIN);
    expect(
      await resolveUserRole({
        id: unverified.id,
        email: unverified.email,
        role: ROLES.SUPER_ADMIN,
      }),
    ).toBe(ROLES.USER);
  });
});
