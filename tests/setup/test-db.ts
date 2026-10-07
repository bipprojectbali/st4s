/**
 * `bun test` preload (bunfig.toml): forces NODE_ENV=test, points DATABASE_URL at exactly one migrated
 * `*_test` database (DATABASE_URL_TEST, else the built-in cluster in data/pg-test) and sets the marker
 * server/db/index.ts requires. The built-in cluster is stopped when the run ends.
 */
import { afterAll } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { migrationsFolder } from '../../server/cli/migrate';
import { BUILTIN_TEST_DB, resolveTestDb, TEST_DB_MARKER } from '../../server/db/test-guard';
import { liveOwner, OWNER_FILE, SOCKET_PORT } from '../../server/local-pg/claim';
import { PG_USER } from '../../server/local-pg/paths';
import { ensureRuntime } from '../../server/local-pg/runtime';
import { type LocalPg, readOrNull, startLocalPg } from '../../server/local-pg/server';

/** Separate from dev's data/pg: own socket, so it runs alongside `bun run dev`. */
export const TEST_PG_DATA = path.resolve(import.meta.dir, '../../data/pg-test');

async function startTestCluster(): Promise<LocalPg> {
  const owner = liveOwner(readOrNull(path.join(TEST_PG_DATA, OWNER_FILE)));
  if (owner)
    throw new Error(
      `Test lain sedang berjalan memakai PostgreSQL test di ${TEST_PG_DATA} (PID ${owner.pid}). ` +
        'Tunggu sampai selesai lalu ulangi, atau isi DATABASE_URL_TEST agar run ini memakai database *_test eksternal.',
    );
  // A copy, so process.env stays free of local-pg overrides; no ST4S_HOME keeps the shared dev cache data/pg-runtime.
  const runtime = await ensureRuntime({ env: { ...process.env, ST4S_HOME: '' } });
  const pg = await startLocalPg({ runtime, dataDir: TEST_PG_DATA });
  const admin = postgres({
    host: pg.socketDir,
    port: SOCKET_PORT,
    user: PG_USER,
    database: 'postgres',
    max: 1,
    onnotice: () => {},
  });
  try {
    const [row] = await admin`select 1 from pg_database where datname = ${BUILTIN_TEST_DB}`;
    if (!row) await admin.unsafe(`create database "${BUILTIN_TEST_DB}"`);
  } catch (e) {
    await pg.stop();
    throw e;
  } finally {
    await admin.end();
  }
  return pg;
}

/** Idempotent; sibling worktrees may share one external test DB, so an advisory lock serializes them. */
async function migrateTestDb(url: string): Promise<void> {
  const sql = postgres(url, { max: 1, connect_timeout: 10, onnotice: () => {} });
  try {
    await sql`select pg_advisory_lock(hashtext('st4s:test-migrate'))`;
    await migrate(drizzle(sql), { migrationsFolder: migrationsFolder(false) });
  } catch (e) {
    throw new Error(`Gagal menyiapkan database test: ${(e as Error).message}`);
  } finally {
    await sql.end(); // closing the session releases the advisory lock
  }
}

const env = process.env;
env.NODE_ENV = 'test';
const plan = resolveTestDb(env);
delete env.DATABASE_URL_TEST;

if (plan.mode === 'external') {
  env.DATABASE_URL = plan.url;
  await migrateTestDb(plan.url);
} else {
  const pg = await startTestCluster();
  afterAll(() => pg.stop());
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
    process.once(sig, () => {
      void pg.stop().finally(() => process.exit(128 + os.constants.signals[sig]));
    });
  // PGHOST/PGPORT/PGUSER point postgres-js (which reads them per client) at the test socket.
  const url = `postgres:///${BUILTIN_TEST_DB}`;
  Object.assign(env, pg.env, { DATABASE_URL: url });
  try {
    await migrateTestDb(url);
  } catch (e) {
    await pg.stop();
    throw e;
  }
}
env[TEST_DB_MARKER] = '1';
