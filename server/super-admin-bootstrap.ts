/**
 * One-time super-admin bootstrap without Google: mark an allowlisted user's
 * email as verified so resolveUserRole grants super-admin. Used by
 * scripts/verify-super-admin.ts; outputs only masked emails.
 */
import { eq, sql } from 'drizzle-orm';
import { db } from './db';
import { user } from './db/schema';
import { isSuperAdminEmail } from './permissions';

export type VerifyOutcome = 'verified' | 'already_verified' | 'not_allowlisted' | 'user_not_found';

/** `owner@example.com` → `o***@example.com`; anything without a usable `@` → `***`. */
export function maskEmail(email: string): string {
  const e = email.trim();
  const at = e.lastIndexOf('@');
  if (at < 1 || at === e.length - 1) return '***';
  return `${e[0]}***${e.slice(at)}`;
}

/** Set email_verified=true for the one user with this allowlisted email; refuses otherwise. */
export async function verifySuperAdminEmail(
  rawEmail: string,
  allowlist: ReadonlySet<string>,
): Promise<VerifyOutcome> {
  const email = rawEmail.trim().toLowerCase();
  if (!email || !isSuperAdminEmail(email, allowlist)) return 'not_allowlisted';
  const match = sql`lower(${user.email}) = ${email}`;
  const [row] = await db
    .select({ id: user.id, emailVerified: user.emailVerified })
    .from(user)
    .where(match)
    .limit(1);
  if (!row) return 'user_not_found';
  if (row.emailVerified) return 'already_verified';
  await db
    .update(user)
    .set({ emailVerified: true, updatedAt: new Date() })
    .where(eq(user.id, row.id));
  return 'verified';
}
