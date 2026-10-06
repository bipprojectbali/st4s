/** Platform gate: unverified platforms need ST4S_PG_ALLOW_UNVERIFIED=1; unsupported hosts never pass. */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localPgChecks } from '../../server/local-pg/doctor';
import { detectPlatform, ensureRuntime, resolvePlatform } from '../../server/local-pg/runtime';

const ALLOW = { ST4S_PG_ALLOW_UNVERIFIED: '1' };
const intel = { platform: 'darwin-x64' as const };

describe('resolvePlatform', () => {
  test('verified platforms pass without a warning', () => {
    for (const platform of ['darwin-arm64', 'linux-x64', 'linux-arm64'] as const)
      expect(resolvePlatform({}, { platform })).toEqual({ platform });
  });

  test('unverified platform is refused with the DATABASE_URL / override hint', () => {
    const r = resolvePlatform({}, intel);
    expect('error' in r && r.error).toBe(
      'Postgres bawaan belum diverifikasi di darwin-x64. Isi DATABASE_URL, atau set ST4S_PG_ALLOW_UNVERIFIED=1 untuk mencoba (staging).',
    );
    // Only exactly "1" opts in.
    expect('error' in resolvePlatform({ ST4S_PG_ALLOW_UNVERIFIED: 'true' }, intel)).toBe(true);
  });

  test('unverified platform + override passes with a one-line warning', () => {
    const r = resolvePlatform(ALLOW, intel);
    expect('platform' in r && r.platform).toBe('darwin-x64');
    expect('warning' in r && r.warning).toContain('belum diverifikasi di darwin-x64');
    expect('warning' in r && r.warning?.includes('\n')).toBe(false);
  });

  test('unsupported hosts stay refused even with the override', () => {
    const musl = resolvePlatform(
      ALLOW,
      detectPlatform({ platform: 'linux', arch: 'x64', musl: true }),
    );
    expect('error' in musl && musl.error).toContain('musl');
    const win = resolvePlatform(
      ALLOW,
      detectPlatform({ platform: 'win32', arch: 'x64', musl: false }),
    );
    expect('error' in win && win.error).toContain('DATABASE_URL');
  });
});

describe('gate at the call sites', () => {
  test('ensureRuntime refuses an unverified platform before touching disk', async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'st4s-gate-'));
    try {
      await expect(
        ensureRuntime({ env: { ST4S_HOME: home }, platform: 'darwin-x64', onProgress: () => {} }),
      ).rejects.toThrow('ST4S_PG_ALLOW_UNVERIFIED=1');
      // With the override it gets past the gate (then fails on the missing manual runtime) and warns.
      const msgs: string[] = [];
      await expect(
        ensureRuntime({
          env: { ...ALLOW, ST4S_PG_RUNTIME: path.join(home, 'none') },
          platform: 'darwin-x64',
          onProgress: (m) => msgs.push(m),
        }),
      ).rejects.toThrow('tidak berisi bin/postgres');
      expect(msgs).toEqual([expect.stringContaining('PERINGATAN')]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('doctor shows verified/unverified and the override state', async () => {
    const env = { ST4S_HOME: '/nonexistent-st4s-home' };
    const line = async (e: Record<string, string>, host: ReturnType<typeof detectPlatform>) =>
      Object.fromEntries((await localPgChecks(e, host)).map((c) => [c.name, c]));

    const ok = await line(env, { platform: 'darwin-arm64' });
    expect(ok['platform Postgres']?.detail).toBe(
      'darwin-arm64 (terverifikasi; ST4S_PG_ALLOW_UNVERIFIED=tidak aktif)',
    );
    const arm = await line(env, { platform: 'linux-arm64' });
    expect(arm['platform Postgres']?.detail).toBe(
      'linux-arm64 (terverifikasi; ST4S_PG_ALLOW_UNVERIFIED=tidak aktif)',
    );

    const refused = await line(env, intel);
    expect(refused['platform Postgres']).toBeUndefined();
    expect(refused['PostgreSQL bawaan']?.ok).toBe(false);
    expect(refused['PostgreSQL bawaan']?.detail).toContain('belum diverifikasi di darwin-x64');

    const allowed = await line({ ...env, ...ALLOW }, intel);
    expect(allowed['platform Postgres']?.detail).toBe(
      'darwin-x64 (BELUM diverifikasi — staging; ST4S_PG_ALLOW_UNVERIFIED=1 aktif)',
    );
    expect(allowed['runtime Postgres']).toBeDefined();
  });
});
