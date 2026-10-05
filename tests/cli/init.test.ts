/** `st4s init`: folders, 0600 .env with the required keys, no overwrite, no secret in output. */
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runInit } from '../../server/cli/init';

let home = '';
let out: string[] = [];
let logSpy: ReturnType<typeof spyOn>;
let errSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  home = path.join(mkdtempSync(path.join(os.tmpdir(), 'st4s-init-')), 'st4s');
  out = [];
  logSpy = spyOn(console, 'log').mockImplementation(
    (...a: unknown[]) => void out.push(a.join(' ')),
  );
  errSpy = spyOn(console, 'error').mockImplementation(
    (...a: unknown[]) => void out.push(a.join(' ')),
  );
});
afterEach(() => {
  logSpy.mockRestore();
  errSpy.mockRestore();
  rmSync(path.dirname(home), { recursive: true, force: true });
});

describe('runInit', () => {
  test('creates folders and a 0600 .env with every required key', async () => {
    expect(await runInit({ ST4S_HOME: home })).toBe(0);
    for (const d of ['lib', 'models', 'logs']) expect(existsSync(path.join(home, d))).toBe(true);
    const file = path.join(home, '.env');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const text = readFileSync(file, 'utf8');
    for (const key of [
      'NODE_ENV=production',
      'PORT=3000',
      'APP_URL=',
      'BETTER_AUTH_URL=',
      'DATABASE_URL=',
      'SUPER_ADMIN_EMAILS=',
    ])
      expect(text).toContain(key);
    const secret = /^BETTER_AUTH_SECRET=(.+)$/m.exec(text)?.[1] ?? '';
    expect(secret.length).toBeGreaterThanOrEqual(43);
    expect(out.join('\n')).not.toContain(secret);
    expect(out.join('\n')).toContain('migrate');
  });

  test('never overwrites an existing .env', async () => {
    await runInit({ ST4S_HOME: home });
    const file = path.join(home, '.env');
    writeFileSync(file, 'MINE=1\n');
    expect(await runInit({ ST4S_HOME: home })).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe('MINE=1\n');
    expect(out.join('\n')).toContain('tidak ditimpa');
  });

  test('fails without a home', async () => {
    expect(await runInit({})).toBe(1);
  });
});
