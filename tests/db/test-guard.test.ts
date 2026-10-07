/** Test-DB isolation: resolver rules, the db/index guard, and the preload as actually loaded by bun test. */
import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { db } from '../../server/db';
import {
  assertTestDatabase,
  isTestProcess,
  resolveTestDb,
  TEST_DB_MARKER,
} from '../../server/db/test-guard';

const ROOT = path.resolve(import.meta.dir, '../..');
const DEV = 'postgres://u:p@localhost:5432/s4s'; // test-only

async function bun(args: string[], env: Record<string, string | undefined>) {
  const p = Bun.spawn(['bun', ...args], { cwd: ROOT, env, stdout: 'pipe', stderr: 'pipe' });
  const [code, out, err] = await Promise.all([
    p.exited,
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  return { code, out: out + err };
}

const childEnv = (over: Record<string, string>) => {
  const env: Record<string, string | undefined> = { ...process.env, ...over };
  delete env[TEST_DB_MARKER];
  return env;
};

describe('resolveTestDb', () => {
  test('empty or unset DATABASE_URL_TEST → built-in test cluster', () => {
    expect(resolveTestDb({ DATABASE_URL: DEV })).toEqual({ mode: 'builtin' });
    expect(resolveTestDb({ DATABASE_URL: DEV, DATABASE_URL_TEST: '  ' })).toEqual({
      mode: 'builtin',
    });
  });
  test('a separate *_test database is used as-is', () => {
    const url = 'postgres://u:p@localhost:5432/s4s_test'; // test-only
    expect(resolveTestDb({ DATABASE_URL: DEV, DATABASE_URL_TEST: url })).toEqual({
      mode: 'external',
      url,
    });
  });
  test('database name without the _test suffix is refused', () => {
    const copy = 'postgres://u:p@h:5432/s4s_copy'; // test-only
    expect(() => resolveTestDb({ DATABASE_URL: DEV, DATABASE_URL_TEST: copy })).toThrow(
      'berakhiran "_test"',
    );
  });
  test('same host+port+db as DATABASE_URL is refused (localhost aliases, default port)', () => {
    const dev = 'postgres://a:b@localhost:5432/app_test'; // test-only
    const same = 'postgres://c:d@127.0.0.1/app_test'; // test-only
    expect(() => resolveTestDb({ DATABASE_URL: dev, DATABASE_URL_TEST: same })).toThrow(
      'database yang sama',
    );
  });
  test('error messages never echo credentials', () => {
    let msg = '';
    try {
      resolveTestDb({ DATABASE_URL_TEST: 'postgres://u:hunter2@h/s4s' }); // test-only
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain('h:5432/s4s');
    expect(msg).not.toContain('hunter2');
  });
});

describe('db/index guard', () => {
  test('a bun test entry counts as test even when a shell NODE_ENV says otherwise', () => {
    expect(isTestProcess({ NODE_ENV: 'development' }, '/r/tests/a.test.ts')).toBe(true);
    expect(isTestProcess({ NODE_ENV: 'development' }, '/r/server/dev.ts')).toBe(false);
    expect(isTestProcess({ NODE_ENV: 'test' }, '/r/scripts/x.ts')).toBe(true);
  });
  test('assertTestDatabase needs the marker and a *_test name', () => {
    const url = 'postgres://u@h/x_test'; // test-only
    expect(() => assertTestDatabase({ DATABASE_URL: url })).toThrow('tanpa preload');
    expect(
      () => assertTestDatabase({ DATABASE_URL: 'postgres://u@h/x', [TEST_DB_MARKER]: '1' }), // test-only
    ).toThrow('berakhiran "_test"');
    expect(() => assertTestDatabase({ DATABASE_URL: url, [TEST_DB_MARKER]: '1' })).not.toThrow();
  });
  test('importing server/db with NODE_ENV=test but no preload marker throws', async () => {
    const r = await bun(
      ['-e', `await import(${JSON.stringify(path.join(ROOT, 'server/db/index.ts'))})`],
      childEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgres://u@127.0.0.1:1/x_test' }), // test-only
    );
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('tanpa preload database test');
  });
});

describe('preload (this run)', () => {
  test('forced test mode, marker set, connected to a *_test database', async () => {
    expect(process.env.NODE_ENV).toBe('test');
    expect(process.env[TEST_DB_MARKER]).toBe('1');
    expect(process.env.DATABASE_URL_TEST).toBeUndefined();
    const [row] = (await db.execute(sql`select current_database() as name`)) as unknown as {
      name: string;
    }[];
    expect(row?.name.endsWith('_test')).toBe(true);
  });
  test('a plain `bun test` with NODE_ENV=development still lands on the test DB', async () => {
    // Reuse this run's test DB as the child's external DATABASE_URL_TEST (the built-in cluster is ours, a second owner is refused).
    const r = await bun(
      ['test', './tests/setup/isolation-probe.ts'],
      childEnv({
        NODE_ENV: 'development',
        DATABASE_URL: '',
        DATABASE_URL_TEST: process.env.DATABASE_URL as string,
      }),
    );
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/PROBE test \S+_test/);
  });
});
