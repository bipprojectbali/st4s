import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../server/db';
import { user } from '../server/db/schema';
import { maskEmail, verifySuperAdminEmail } from '../server/super-admin-bootstrap';

const RUN = crypto.randomUUID();
const OWNER = `owner-${RUN}@test.local`;
const BYSTANDER = `bystander-${RUN}@test.local`;
const NOT_LISTED = `stranger-${RUN}@test.local`;
const ALLOWLIST: ReadonlySet<string> = new Set([OWNER, BYSTANDER, `ghost-${RUN}@test.local`]);
const ids = { owner: `vsa-owner-${RUN}`, bystander: `vsa-by-${RUN}`, stranger: `vsa-st-${RUN}` };

async function verifiedOf(id: string): Promise<boolean | undefined> {
  const [row] = await db.select({ v: user.emailVerified }).from(user).where(eq(user.id, id));
  return row?.v;
}

beforeAll(async () => {
  await db.insert(user).values([
    { id: ids.owner, name: 'Owner', email: OWNER, emailVerified: false },
    { id: ids.bystander, name: 'Bystander', email: BYSTANDER, emailVerified: false },
    { id: ids.stranger, name: 'Stranger', email: NOT_LISTED, emailVerified: false },
  ]);
});

afterAll(async () => {
  await db.delete(user).where(inArray(user.id, Object.values(ids)));
});

describe('maskEmail', () => {
  test('keeps the first character and the domain only', () => {
    expect(maskEmail('owner@example.com')).toBe('o***@example.com');
    expect(maskEmail('  Owner@Example.com ')).toBe('O***@Example.com');
  });

  test('never echoes input without a usable @', () => {
    expect(maskEmail('not-an-email')).toBe('***');
    expect(maskEmail('@example.com')).toBe('***');
    expect(maskEmail('owner@')).toBe('***');
  });
});

describe('verifySuperAdminEmail', () => {
  test('refuses an email outside SUPER_ADMIN_EMAILS and leaves the row untouched', async () => {
    expect(await verifySuperAdminEmail(NOT_LISTED, ALLOWLIST)).toBe('not_allowlisted');
    expect(await verifiedOf(ids.stranger)).toBe(false);
  });

  test('refuses an allowlisted email with no user', async () => {
    expect(await verifySuperAdminEmail(`ghost-${RUN}@test.local`, ALLOWLIST)).toBe(
      'user_not_found',
    );
  });

  test('refuses an empty email', async () => {
    expect(await verifySuperAdminEmail('  ', ALLOWLIST)).toBe('not_allowlisted');
  });

  test('verifies exactly the matching row (case-insensitive) and is idempotent', async () => {
    expect(await verifySuperAdminEmail(`  ${OWNER.toUpperCase()} `, ALLOWLIST)).toBe('verified');
    expect(await verifiedOf(ids.owner)).toBe(true);
    expect(await verifiedOf(ids.bystander)).toBe(false);
    expect(await verifiedOf(ids.stranger)).toBe(false);
    expect(await verifySuperAdminEmail(OWNER, ALLOWLIST)).toBe('already_verified');
  });
});
