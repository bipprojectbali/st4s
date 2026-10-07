/** Dev DB tooling (scripts/dev-db.ts, drizzle.config.ts): never a test DB, never a hardcoded DB, dev paths under ./data. */
import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { runDrizzleKit, sourceCliError, testDbError } from '../scripts/dev-db';
import { doctorChecks } from '../server/cli/doctor';
import { backupsDir } from '../server/local-pg/archive';
import { acquireLocalPg } from '../server/local-pg/boot';

type Env = Record<string, string | undefined>;
const ROOT = path.join(import.meta.dir, '..');

function recorder() {
  const calls: { cmd: string[]; url?: string }[] = [];
  const spawn = async (cmd: string[], env: Env) => {
    calls.push({ cmd, url: env.DATABASE_URL });
    return 0;
  };
  return { calls, spawn };
}

describe('testDbError', () => {
  test('refuses a *_test database, from the URL path or PGDATABASE', () => {
    expect(testDbError({ DATABASE_URL: 'postgres://u:p@h:5432/app_test' })).toContain('"app_test"'); // test-only
    expect(testDbError({ DATABASE_URL: 'postgres://u@h/APP_TEST?sslmode=disable' })).not.toBeNull(); // test-only
    expect(testDbError({ DATABASE_URL: 'postgres://u@h', PGDATABASE: 'x_test' })).not.toBeNull(); // test-only
    expect(testDbError({ DATABASE_URL: 'not a url' })).toContain('tidak valid');
  });

  test('allows a dev database and the built-in Postgres (empty URL)', () => {
    expect(testDbError({ DATABASE_URL: 'postgres://u@h/app' })).toBeNull(); // test-only
    expect(testDbError({ DATABASE_URL: 'postgres://u@h/test_app' })).toBeNull(); // test-only
    expect(testDbError({ DATABASE_URL: ' ' })).toBeNull();
    expect(testDbError({})).toBeNull();
  });
});

describe('runDrizzleKit', () => {
  test('DATABASE_URL set: passthrough, argv without a shell, nothing started', async () => {
    const { calls, spawn } = recorder();
    const env = { DATABASE_URL: 'postgres://u@h/app' }; // test-only
    // Real acquireLocalPg: with a URL it must return a no-op without touching Postgres.
    expect(
      await runDrizzleKit(['push', '--x=a;rm -rf /'], env, { acquire: acquireLocalPg, spawn }),
    ).toBe(0);
    expect(calls).toEqual([
      {
        cmd: [process.execPath, 'x', 'drizzle-kit', 'push', '--x=a;rm -rf /'],
        url: 'postgres://u@h/app', // test-only
      },
    ]);
    expect(Object.keys(env)).toEqual(['DATABASE_URL']);
  });

  test('DATABASE_URL empty: acquire injects the URL, release runs after the child, even on failure', async () => {
    const events: string[] = [];
    const acquire = async (env: Env = {}) => {
      events.push('acquire');
      env.DATABASE_URL = 'postgres:///st4s'; // test-only
      return async () => {
        events.push('release');
      };
    };
    const { calls, spawn } = recorder();
    expect(await runDrizzleKit(['studio'], { DATABASE_URL: '' }, { acquire, spawn })).toBe(0);
    expect(calls[0]?.url).toBe('postgres:///st4s');
    expect(events).toEqual(['acquire', 'release']);

    const failing = async () => {
      events.push('spawn');
      throw new Error('boom');
    };
    await expect(runDrizzleKit(['push'], {}, { acquire, spawn: failing })).rejects.toThrow('boom');
    expect(events.slice(2)).toEqual(['acquire', 'spawn', 'release']);
  });
});

describe('st4s from source', () => {
  test('refuses init and the bare server; subcommands pass', () => {
    expect(sourceCliError(['init'])).toContain('bun run db:migrate');
    expect(sourceCliError([])).toContain('bun run dev');
    for (const cmd of ['doctor', 'migrate', 'db', '--version'])
      expect(sourceCliError([cmd])).toBeNull();
  });

  test('dev paths stay under ./data and doctor accepts a missing ST4S_HOME', async () => {
    expect(backupsDir({})).toBe(path.resolve('data', 'backups'));
    const checks = await doctorChecks({ env: {}, loadLib: () => {}, freePct: () => 80 });
    const home = checks.find((c) => c.name === 'folder st4s');
    expect(home).toMatchObject({ ok: true, required: false });
  });
});

describe('drizzle.config.ts', () => {
  const load = (cmd: string) =>
    Bun.spawnSync([process.execPath, 'drizzle.config.ts', cmd], {
      cwd: ROOT,
      env: { PATH: process.env.PATH, DATABASE_URL: '' },
      stderr: 'pipe',
    });

  test('no hardcoded fallback: DB commands fail with a clear message, generate needs no URL', async () => {
    const push = load('push');
    expect(push.exitCode).not.toBe(0);
    expect(push.stderr.toString()).toContain('DATABASE_URL kosong');
    expect(load('generate').exitCode).toBe(0);
    expect(await Bun.file(path.join(ROOT, 'drizzle.config.ts')).text()).not.toContain(
      'postgres://',
    );
  });
});
