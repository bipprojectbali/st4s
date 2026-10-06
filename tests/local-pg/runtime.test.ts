/** Runtime layout, platform table and the verify-before-extract install (with synthetic jars — never downloads). */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import {
  isLocalPgMode,
  PG_RELEASE,
  pgDataDir,
  pgRuntimeDir,
  pgRuntimeIsManual,
} from '../../server/local-pg/paths';
import {
  detectPlatform,
  ensureRuntime,
  installedSha256,
  PG_ARTIFACTS,
  type PgArtifact,
  sha256File,
} from '../../server/local-pg/runtime';

let tmp = '';
beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'st4s-pgrt-'));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

/** Minimal single-entry zip (deflated), the shape of a zonky jar. */
function zip(name: string, data: Uint8Array): Uint8Array {
  const body = deflateRawSync(data);
  const n = Buffer.from(name);
  const crc = Bun.hash.crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(n.length, 26);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);
  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(crc, 16);
  cd.writeUInt32LE(body.length, 20);
  cd.writeUInt32LE(data.length, 24);
  cd.writeUInt16LE(n.length, 28);
  const cdOff = 30 + n.length + body.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(46 + n.length, 12);
  eocd.writeUInt32LE(cdOff, 16);
  return Buffer.concat([local, n, body, cd, n, eocd]);
}

/** A jar whose postgres-*.txz holds bin/postgres (a shell stub). */
function fakeJar(): string {
  const src = path.join(tmp, 'src');
  mkdirSync(path.join(src, 'bin'), { recursive: true });
  writeFileSync(
    path.join(src, 'bin', 'postgres'),
    '#!/bin/sh\necho "postgres (PostgreSQL) 17.11"\n',
    {
      mode: 0o755,
    },
  );
  const txz = Bun.spawnSync(['tar', '-cJf', '-', '-C', src, 'bin']);
  if (txz.exitCode !== 0) throw new Error(`tar -cJf gagal: ${txz.stderr.toString()}`);
  const jar = path.join(tmp, 'fake.jar');
  writeFileSync(jar, zip('postgres-darwin-arm_64.txz', new Uint8Array(txz.stdout)));
  return jar;
}

const artifactFor = async (jar: string): Promise<PgArtifact> => ({
  zonky: 'test',
  sha256: await sha256File(jar),
  size: 1,
  verified: true,
});
const quiet = () => {};

describe('paths', () => {
  test('local mode only for an empty/unset DATABASE_URL', () => {
    expect(isLocalPgMode({})).toBe(true);
    expect(isLocalPgMode({ DATABASE_URL: '  ' })).toBe(true);
    expect(isLocalPgMode({ DATABASE_URL: 'postgres://u@h/db' })).toBe(false);
  });
  test('home layout, dev layout and overrides', () => {
    const home = '/opt/st4s home';
    expect(pgRuntimeDir('linux-x64', { ST4S_HOME: home })).toBe(
      path.join(home, 'lib/pg', PG_RELEASE, 'linux-x64'),
    );
    expect(pgDataDir({ ST4S_HOME: home })).toBe(path.join(home, 'pg/data'));
    expect(pgRuntimeDir('linux-x64', {})).toBe(
      path.resolve('data/pg-runtime', PG_RELEASE, 'linux-x64'),
    );
    expect(pgDataDir({})).toBe(path.resolve('data/pg'));
    const env = { ST4S_HOME: home, ST4S_PG_RUNTIME: '/rt', ST4S_PG_DATA: '/d' };
    expect(pgRuntimeDir('linux-x64', env)).toBe('/rt');
    expect(pgDataDir(env)).toBe('/d');
    expect(pgRuntimeIsManual(env)).toBe(true);
    expect(pgRuntimeIsManual({ ST4S_HOME: home })).toBe(false);
  });
});

describe('detectPlatform', () => {
  test('supported glibc/macOS hosts map to a pinned artifact', () => {
    expect(detectPlatform({ platform: 'darwin', arch: 'arm64', musl: false })).toEqual({
      platform: 'darwin-arm64',
    });
    expect(detectPlatform({ platform: 'linux', arch: 'x64', musl: false })).toEqual({
      platform: 'linux-x64',
    });
  });
  test('musl and unknown hosts are told to use DATABASE_URL', () => {
    const musl = detectPlatform({ platform: 'linux', arch: 'x64', musl: true });
    expect('error' in musl && musl.error).toContain('musl');
    const win = detectPlatform({ platform: 'win32', arch: 'x64', musl: false });
    expect('error' in win && win.error).toContain('DATABASE_URL');
  });
  test('every pin is a sha256; only darwin-x64 is still unverified', () => {
    for (const a of Object.values(PG_ARTIFACTS)) expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(
      Object.entries(PG_ARTIFACTS)
        .filter(([, a]) => !a.verified)
        .map(([k]) => k),
    ).toEqual(['darwin-x64']);
  });
});

describe('ensureRuntime', () => {
  const opts = (env: Record<string, string>, artifact: PgArtifact) => ({
    env,
    platform: 'darwin-arm64' as const,
    artifact,
    onProgress: quiet,
  });

  test('archive with the wrong checksum is refused before extracting anything', async () => {
    const jar = fakeJar();
    const home = path.join(tmp, 'home');
    const bad = { ...(await artifactFor(jar)), sha256: 'f'.repeat(64) };
    await expect(
      ensureRuntime(opts({ ST4S_HOME: home, ST4S_PG_ARCHIVE: jar }, bad)),
    ).rejects.toThrow('Arsip ditolak');
    const base = path.join(home, 'lib/pg', PG_RELEASE);
    expect(existsSync(path.join(base, 'darwin-arm64'))).toBe(false);
    expect(readdirSync(base)).toEqual([]);
  });

  test('matching archive installs atomically with a marker; warm call needs no archive', async () => {
    const jar = fakeJar();
    const home = path.join(tmp, 'home');
    const artifact = await artifactFor(jar);
    const dir = await ensureRuntime(opts({ ST4S_HOME: home, ST4S_PG_ARCHIVE: jar }, artifact));
    expect(dir).toBe(path.join(home, 'lib/pg', PG_RELEASE, 'darwin-arm64'));
    expect(existsSync(path.join(dir, 'bin/postgres'))).toBe(true);
    expect(await installedSha256(dir)).toBe(artifact.sha256);
    expect(readdirSync(path.dirname(dir))).toEqual(['darwin-arm64']);
    rmSync(jar);
    expect(await ensureRuntime(opts({ ST4S_HOME: home, ST4S_PG_ARCHIVE: jar }, artifact))).toBe(
      dir,
    );
  });

  test('a zip without postgres-*.txz is refused', async () => {
    const jar = path.join(tmp, 'empty.jar');
    writeFileSync(jar, zip('README.txt', new TextEncoder().encode('hi')));
    await expect(
      ensureRuntime(
        opts({ ST4S_HOME: path.join(tmp, 'h'), ST4S_PG_ARCHIVE: jar }, await artifactFor(jar)),
      ),
    ).rejects.toThrow('tidak berisi postgres-*.txz');
  });

  test('ST4S_PG_RUNTIME is used as-is and never installed into', async () => {
    const rt = path.join(tmp, 'rt');
    const env = { ST4S_PG_RUNTIME: rt };
    await expect(ensureRuntime(opts(env, PG_ARTIFACTS['darwin-arm64']))).rejects.toThrow(
      'tidak berisi bin/postgres',
    );
    expect(existsSync(rt)).toBe(false);
    mkdirSync(path.join(rt, 'bin'), { recursive: true });
    writeFileSync(path.join(rt, 'bin/postgres'), '');
    expect(await ensureRuntime(opts(env, PG_ARTIFACTS['darwin-arm64']))).toBe(rt);
  });
});
