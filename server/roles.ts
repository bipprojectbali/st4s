import { eq } from 'drizzle-orm';
import { db } from './db';
import { user as userTable } from './db/schema';
import { superAdminEmails } from './env';
import { isSuperAdminEmail, normalizeRole, type Role, reconcileRole } from './permissions';

type ResolvableUser = {
  id: string;
  email: string;
  role?: string | null;
  emailVerified?: boolean | null;
};

const NO_EMAILS: ReadonlySet<string> = new Set();

async function isEmailVerified(u: ResolvableUser): Promise<boolean> {
  if (u.emailVerified != null) return u.emailVerified === true;
  // Callers that select a partial user row (e.g. the API-key owner) omit the flag.
  const [row] = await db
    .select({ emailVerified: userTable.emailVerified })
    .from(userTable)
    .where(eq(userTable.id, u.id))
    .limit(1);
  return row?.emailVerified === true;
}

/**
 * Reconcile a user's stored role against SUPER_ADMIN_EMAILS (the source of
 * truth for super-admin) and return the effective role. The allowlist only
 * counts for a verified email, so signing up first with an allowlisted address
 * grants nothing. Writes to the DB only when the role actually changes.
 */
export async function resolveUserRole(u: ResolvableUser): Promise<Role> {
  const allowlisted = isSuperAdminEmail(u.email, superAdminEmails);
  const trusted = allowlisted && (await isEmailVerified(u)) ? superAdminEmails : NO_EMAILS;
  const desired = reconcileRole(u.email, u.role, trusted);
  if (desired !== normalizeRole(u.role)) {
    await db.update(userTable).set({ role: desired }).where(eq(userTable.id, u.id));
  }
  return desired;
}
