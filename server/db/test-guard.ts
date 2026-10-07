/** Test-DB isolation rules shared by the `bun test` preload (tests/setup/test-db.ts) and server/db/index.ts. Env-free on purpose. */
type Env = Record<string, string | undefined>;

/** Set by the preload once DATABASE_URL points at a migrated *_test database. */
export const TEST_DB_MARKER = 'ST4S_TEST_DB_GUARD';
export const TEST_DB_SUFFIX = '_test';
/** Database the preload creates inside the built-in test cluster (./data/pg-test). */
export const BUILTIN_TEST_DB = 'st4s_test';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export type DbIdentity = { host: string; port: string; db: string };

/** host:port/db a postgres URL resolves to (an empty host/port falls back to PGHOST/PGPORT like postgres-js). Never echoes credentials. */
export function dbIdentity(url: string, key: string, env: Env = {}): DbIdentity {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`${key} bukan URL PostgreSQL yang valid — perbaiki nilainya di .env.`);
  }
  const host = (decodeURIComponent(u.hostname) || env.PGHOST || 'localhost').toLowerCase();
  return {
    host: LOCAL_HOSTS.has(host) ? 'localhost' : host,
    port: u.port || env.PGPORT || '5432',
    db: decodeURIComponent(u.pathname.slice(1)),
  };
}

const show = (i: DbIdentity) => `${i.host}:${i.port}/${i.db || '(kosong)'}`;

export type TestDbPlan = { mode: 'external'; url: string } | { mode: 'builtin' };

/**
 * DATABASE_URL_TEST empty/unset → built-in test cluster. Set → used only when its database ends
 * with `_test` and is not the DATABASE_URL database; otherwise throws. There is no fallback.
 */
export function resolveTestDb(env: Env): TestDbPlan {
  const url = env.DATABASE_URL_TEST?.trim();
  if (!url) return { mode: 'builtin' };
  const test = dbIdentity(url, 'DATABASE_URL_TEST');
  if (!test.db.endsWith(TEST_DB_SUFFIX))
    throw new Error(
      `DATABASE_URL_TEST menunjuk ${show(test)}, padahal nama database test wajib berakhiran "${TEST_DB_SUFFIX}". ` +
        'Ganti ke database khusus test (mis. s4s_test), atau kosongkan DATABASE_URL_TEST agar test memakai PostgreSQL bawaan di data/pg-test.',
    );
  const devUrl = env.DATABASE_URL?.trim();
  if (devUrl) {
    const dev = dbIdentity(devUrl, 'DATABASE_URL');
    if (dev.host === test.host && dev.port === test.port && dev.db === test.db)
      throw new Error(
        `DATABASE_URL_TEST dan DATABASE_URL menunjuk database yang sama (${show(test)}). ` +
          'Buat database terpisah untuk test (mis. s4s_test) atau kosongkan DATABASE_URL_TEST.',
      );
  }
  return { mode: 'external', url };
}

/** True inside `bun test` (NODE_ENV=test, or the entry is a test file even when a shell NODE_ENV overrides it). */
export const isTestProcess = (env: Env, main: string = Bun.main) =>
  env.NODE_ENV === 'test' || /[._](test|spec)\.[cm]?[jt]sx?$/.test(main);

/** Throws unless the preload prepared env and DATABASE_URL names a `*_test` database. */
export function assertTestDatabase(env: Env): void {
  if (env[TEST_DB_MARKER] !== '1')
    throw new Error(
      'Test berjalan tanpa preload database test, jadi koneksi ke database ditolak. ' +
        'Jalankan test dari root repo (`bun run test` atau `bun test <file>`) agar bunfig.toml memuat tests/setup/test-db.ts.',
    );
  const id = dbIdentity(env.DATABASE_URL ?? '', 'DATABASE_URL', env);
  if (!id.db.endsWith(TEST_DB_SUFFIX))
    throw new Error(
      `Mode test menolak database ${show(id)}: nama database test wajib berakhiran "${TEST_DB_SUFFIX}".`,
    );
}
