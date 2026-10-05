/** Binary argv dispatch and `<ST4S_HOME>/.env` loading. */
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pkg from '../../package.json' with { type: 'json' };
import { loadHomeEnv, resolveCommand } from '../../server/cli/dispatch';
import { bootMigrationError, migrationState, migrationsFolder } from '../../server/cli/migrate';
import { versionLine } from '../../server/cli/version';

const argv = (...args: string[]) => ['/x/st4s', '/$bunfs/root/st4s', ...args];

describe('resolveCommand', () => {
  test('engine child is checked first', () => {
    expect(resolveCommand(argv('--st4s-engine-child', 'stt'))).toBe('engine-child');
    expect(resolveCommand(argv('--st4s-engine-child', 'init'))).toBe('engine-child');
  });
  test('subcommands and flags', () => {
    for (const c of ['init', 'doctor', 'migrate', 'models'] as const)
      expect(resolveCommand(argv(c, 'x'))).toBe(c);
    expect(resolveCommand(argv('--version'))).toBe('version');
    expect(resolveCommand(argv('-h'))).toBe('help');
    expect(resolveCommand(argv('--help'))).toBe('help');
  });
  test('no args or unknown flag → server; unknown word → unknown', () => {
    expect(resolveCommand(argv())).toBe('server');
    expect(resolveCommand(argv('--port=1'))).toBe('server');
    expect(resolveCommand(argv('serve'))).toBe('unknown');
  });
});

describe('loadHomeEnv', () => {
  let home = '';
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    delete process.env.ST4S_T4_FROM_HOME;
    delete process.env.ST4S_T4_REAL;
  });
  test('loads <home>/.env without overriding the real env', () => {
    home = mkdtempSync(path.join(os.tmpdir(), 'st4s-home-'));
    writeFileSync(path.join(home, '.env'), 'ST4S_T4_FROM_HOME=home\nST4S_T4_REAL=home\n');
    process.env.ST4S_T4_REAL = 'real';
    expect(loadHomeEnv({ ST4S_HOME: home })).toBe(path.join(home, '.env'));
    expect(process.env.ST4S_T4_FROM_HOME).toBe('home');
    expect(process.env.ST4S_T4_REAL).toBe('real');
  });
  test('no home or no file → null', () => {
    home = mkdtempSync(path.join(os.tmpdir(), 'st4s-home-'));
    expect(loadHomeEnv({})).toBeNull();
    expect(loadHomeEnv({ ST4S_HOME: home })).toBeNull();
  });
});

describe('version and migrations', () => {
  test('version comes from package.json', () => {
    expect(versionLine()).toStartWith(`${pkg.name} ${pkg.version}`);
  });
  test('binary builds keep NODE_ENV a runtime read and skip cwd autoload', () => {
    const builds = Object.entries(pkg.scripts).filter(([k]) => k.startsWith('build:binary'));
    expect(builds.length).toBe(3);
    for (const [, cmd] of builds)
      for (const flag of [
        '--define process.env.NODE_ENV=process.env.NODE_ENV',
        '--no-compile-autoload-dotenv',
        '--asset ./server/db/migrations',
      ])
        expect(cmd).toContain(flag);
  });
  test('source-mode migrations folder holds the drizzle journal', () => {
    expect(Bun.file(path.join(migrationsFolder(false), 'meta/_journal.json')).size).toBeGreaterThan(
      0,
    );
  });
  test('boot guard refuses without DATABASE_URL', async () => {
    expect(await bootMigrationError({})).toContain('DATABASE_URL');
  });
  test('test database has no pending migrations', async () => {
    const url = process.env.DATABASE_URL_TEST;
    if (!url) throw new Error('DATABASE_URL_TEST missing');
    const s = await migrationState(url);
    expect(s.total).toBeGreaterThan(0);
    expect(s.pending).toBe(0);
    expect(await bootMigrationError({ DATABASE_URL: url })).toBeNull();
  });
});
