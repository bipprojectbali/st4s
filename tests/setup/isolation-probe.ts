/** Run by tests/db/test-guard.test.ts as a child `bun test`: prints what the preload left behind. */
import { test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { db } from '../../server/db';

test('probe', async () => {
  const [row] = (await db.execute(sql`select current_database() as name`)) as unknown as {
    name: string;
  }[];
  console.log(`PROBE ${process.env.NODE_ENV} ${row?.name}`);
});
