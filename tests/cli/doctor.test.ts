/** `st4s doctor` on temp homes: missing items fail, quarantine is detected and blocks dlopen. */
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { doctorChecks, quarantinedPaths, runDoctor } from '../../server/cli/doctor';
import { CRISPASR_LIB_FILE } from '../../server/st4s-home';

let home = '';
const byName = async (probe: Parameters<typeof doctorChecks>[0]) =>
  Object.fromEntries((await doctorChecks(probe)).map((c) => [c.name, c]));
const noLoad = () => {
  throw new Error('loadLib must not be called');
};
const quarantine = (file: string) =>
  Bun.spawnSync(['xattr', '-w', 'com.apple.quarantine', '0083;00000000;Safari;', file]);

beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), 'st4s-doctor-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('doctor', () => {
  test('empty home reports missing items and exits 1', async () => {
    const env = { ST4S_HOME: home, PATH: process.env.PATH };
    const c = await byName({ env, loadLib: noLoad, freePct: () => 80 });
    for (const name of [
      '.env',
      'DATABASE_URL',
      'BETTER_AUTH_SECRET',
      'libcrispasr',
      'model STT',
      'model TTS onnx/',
    ])
      expect(c[name]?.ok).toBe(false);
    expect(c['folder st4s']?.ok).toBe(true);
    expect(c['.env']?.fix).toContain('st4s init');
    expect(c['model STT']?.detail).toContain(path.join(home, 'models', 'stt'));
    const log = spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(await runDoctor({ env, loadLib: noLoad, freePct: () => 80 })).toBe(1);
    } finally {
      log.mockRestore();
    }
  });

  test('reports pending migrations and prints secret names only', async () => {
    const env = {
      ST4S_HOME: home,
      DATABASE_URL: 'postgres://u:hunter2@h/db',
      BETTER_AUTH_SECRET: 's3cr3t-value',
    };
    const checks = await doctorChecks({
      env,
      loadLib: noLoad,
      freePct: () => 80,
      dbState: async () => ({ total: 13, pending: 2 }),
    });
    const db = checks.find((c) => c.name === 'database');
    expect(db?.ok).toBe(false);
    expect(db?.fix).toContain('st4s migrate');
    const text = JSON.stringify(checks);
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('s3cr3t-value');
  });

  test.if(process.platform === 'darwin')(
    'detects quarantine and never dlopens a quarantined lib',
    async () => {
      const plain = path.join(home, 'plain.txt');
      writeFileSync(plain, 'x');
      expect(quarantinedPaths(home)).toEqual([]);
      quarantine(plain);
      expect(quarantinedPaths(home)).toEqual([plain]);

      mkdirSync(path.join(home, 'lib'));
      writeFileSync(path.join(home, 'lib', CRISPASR_LIB_FILE), 'not a real lib');
      const c = await byName({ env: { ST4S_HOME: home }, loadLib: noLoad, freePct: () => 80 });
      expect(c['karantina macOS']?.ok).toBe(false);
      expect(c['karantina macOS']?.fix).toContain('xattr -dr com.apple.quarantine');
      expect(c.libcrispasr?.ok).toBe(false);
      expect(c.libcrispasr?.detail).toContain('karantina');
    },
  );
});
