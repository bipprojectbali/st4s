/** `st4s db backup/restore` against a fake data dir and the system tar: refusals, archive safety, no partial/overwrite, swap keeps old data. */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { confirmRestore, runDb } from '../../server/cli/db';
import { entriesError, manifestError, newestBackup, tar } from '../../server/local-pg/archive';
import { backupDb, EXTERNAL_DB, inUseError, restoreDb } from '../../server/local-pg/backup';
import type { ProcInfo } from '../../server/local-pg/claim';

const fakeProc = (table: Record<number, { comm: string; started: string }>): ProcInfo => ({
  alive: (pid) => pid in table,
  comm: (pid) => table[pid]?.comm ?? '',
  started: (pid) => table[pid]?.started ?? '',
});
const proc = fakeProc({
  11: { comm: '/rt/bin/postgres', started: 'a' },
  22: { comm: '/rt/bin/st4s', started: 'b' },
  33: { comm: '', started: '' },
});
const pidFile = (pid: number, dir: string) =>
  `${pid}\n${dir}\n1700000000\n5432\n/s\n\n  1  2\nready\n`;
const yes = () => true;

let home = '';
let data = '';
let env: Record<string, string | undefined> = {};
const opts = () => ({ env, proc });
const t1 = new Date('2026-10-06T10:00:00Z');
const t2 = new Date('2026-10-06T11:00:00Z');

beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), 'st4s-backup-test-'));
  env = { ST4S_HOME: home };
  data = path.join(home, 'pg', 'data');
  mkdirSync(path.join(data, 'base'), { recursive: true, mode: 0o700 });
  writeFileSync(path.join(data, 'PG_VERSION'), '17\n');
  writeFileSync(path.join(data, 'base', 'marker'), 'v1');
});
afterEach(() => {
  chmodSync(home, 0o700);
  rmSync(home, { recursive: true, force: true });
});

describe('manifestError', () => {
  const ok = { format: 1, pgMajor: 17, pgVersion: '17.11.0', st4sVersion: '0.3.0', createdAt: 'x' };
  test('accepts format 1 / same major', () => expect(manifestError(JSON.stringify(ok))).toBeNull());
  test('missing', () => expect(manifestError(null)).toContain('bukan backup st4s'));
  test('not JSON', () => expect(manifestError('{')).toContain('bukan JSON'));
  test('wrong format', () =>
    expect(manifestError(JSON.stringify({ ...ok, format: 2 }))).toContain('Format backup 2'));
  test('wrong major', () =>
    expect(manifestError(JSON.stringify({ ...ok, pgMajor: 16 }))).toContain('PostgreSQL 16'));
});

describe('entriesError', () => {
  const v = (names: string[], t = '-') => names.map((n) => `${t}rw-r--r--  0 a a 1 x ${n}`);
  const base = ['st4s-backup.json', 'data/', 'data/PG_VERSION'];
  test('accepts data/ plus manifest', () => expect(entriesError(base, v(base))).toBeNull());
  for (const evil of ['../x', 'data/../../x', '/etc/passwd', 'other/x'])
    test(`rejects ${evil}`, () => {
      const names = [...base, evil];
      expect(entriesError(names, v(names))).toContain('di luar data/');
    });
  test('rejects links', () => {
    const names = [...base, 'data/l'];
    expect(entriesError(names, [...v(base), ...v(['data/l'], 'l')])).toContain('link');
  });
  test('requires data/PG_VERSION', () =>
    expect(entriesError(['data/x'], v(['data/x']))).toContain('PG_VERSION'));
});

describe('refusals', () => {
  test('DATABASE_URL set → pg_dump hint, nothing written', async () => {
    env.DATABASE_URL = 'postgres://u@h/db';
    await expect(backupDb(undefined, opts())).rejects.toThrow(EXTERNAL_DB);
    await expect(restoreDb(path.join(home, 'x.tar.gz'), yes, opts())).rejects.toThrow('pg_dump');
    expect(existsSync(path.join(home, 'backups'))).toBe(false);
  });
  test('running postmaster / unknown pid / live owner (known or not) → in use', async () => {
    const cases: [string, string, string][] = [
      ['postmaster.pid', pidFile(11, data), 'Postgres PID 11 masih berjalan'],
      ['postmaster.pid', pidFile(33, data), 'tidak bisa dipastikan bukan Postgres'],
      ['st4s.owner', '22 b\n', 'st4s PID 22'],
      ['st4s.owner', '33 b\n', 'PID 33 memegang st4s.owner'],
    ];
    for (const [file, body, why] of cases) {
      writeFileSync(path.join(data, file), body);
      expect(inUseError(data, proc)).toContain(why);
      await expect(backupDb(undefined, opts())).rejects.toThrow('Hentikan st4s dulu');
      await expect(restoreDb(path.join(home, 'none'), yes, opts())).rejects.toThrow();
      expect(readFileSync(path.join(data, file), 'utf8')).toBe(body); // lock files never deleted
      rmSync(path.join(data, file));
    }
    expect(readdirSync(home)).toEqual(['pg']);
  });
  test('stale lock files do not block and are not archived', async () => {
    writeFileSync(path.join(data, 'postmaster.pid'), pidFile(99, data));
    writeFileSync(path.join(data, 'st4s.owner'), '98 z\n');
    const r = await backupDb(undefined, { ...opts(), now: t1 });
    const names = (await tar(['-tzf', r.file])).split('\n');
    expect(names).toContain('data/base/marker');
    expect(names.some((n) => /postmaster\.pid|st4s\.owner/.test(n))).toBe(false);
    expect(readFileSync(path.join(data, 'postmaster.pid'), 'utf8')).toBe(pidFile(99, data));
    expect(existsSync(path.join(data, 'st4s.owner'))).toBe(false); // stale claim taken over, then released
  });
  test('non-TTY restore without --yes refuses', () => {
    expect(() => confirmRestore(false, false)({} as never)).toThrow('--yes');
    expect(confirmRestore(true, false)({} as never)).toBe(true);
  });
  test('bad CLI args → usage, exit 2', async () => {
    expect(await runDb(['backup', '--out'], env)).toBe(2);
    expect(await runDb(['restore'], env)).toBe(2);
    expect(await runDb(['nope'], env)).toBe(2);
  });
});

describe('backupDb', () => {
  test('default path, modes, manifest, owner released, doctor sees it', async () => {
    const r = await backupDb(undefined, { ...opts(), now: t1 });
    expect(r.file).toBe(path.join(home, 'backups', 'st4s-db-20261006-100000Z.tar.gz'));
    expect(statSync(r.file).mode & 0o777).toBe(0o600);
    expect(statSync(path.dirname(r.file)).mode & 0o777).toBe(0o700);
    expect(r.bytes).toBe(statSync(r.file).size);
    const m = JSON.parse(await tar(['-xzOf', r.file, 'st4s-backup.json']));
    expect(m).toMatchObject({ format: 1, pgMajor: 17, pgVersion: '17.11.0' });
    expect(m.createdAt).toBe(t1.toISOString());
    expect(existsSync(path.join(data, 'st4s.owner'))).toBe(false);
    expect(newestBackup(path.join(home, 'backups'))?.name).toBe(path.basename(r.file));
  });
  test('never overwrites --out', async () => {
    const out = path.join(home, 'keep.tar.gz');
    writeFileSync(out, 'precious');
    await expect(backupDb(out, opts())).rejects.toThrow('tidak pernah menimpa');
    expect(readFileSync(out, 'utf8')).toBe('precious');
  });
  test('tar failure leaves no partial, no archive, no owner', async () => {
    const out = path.join(home, 'fail.tar.gz');
    writeFileSync(path.join(data, 'base', 'locked'), 'x');
    chmodSync(path.join(data, 'base', 'locked'), 0o000);
    await expect(backupDb(out, opts())).rejects.toThrow('tar gagal');
    chmodSync(path.join(data, 'base', 'locked'), 0o600);
    expect(readdirSync(home).sort()).toEqual(['pg']);
    expect(existsSync(path.join(data, 'st4s.owner'))).toBe(false);
  });
});

describe('restoreDb', () => {
  test('swaps in the backup and keeps the old data dir', async () => {
    const { file } = await backupDb(undefined, { ...opts(), now: t1 });
    writeFileSync(path.join(data, 'base', 'marker'), 'v2');
    const r = await restoreDb(file, yes, { ...opts(), now: t2 });
    expect(readFileSync(path.join(data, 'base', 'marker'), 'utf8')).toBe('v1');
    expect(statSync(data).mode & 0o777).toBe(0o700);
    expect(r.previous).toBe(`${data}.before-restore-20261006-110000Z`);
    expect(readFileSync(path.join(r.previous as string, 'base', 'marker'), 'utf8')).toBe('v2');
    expect(readdirSync(path.join(home, 'pg')).sort()).toEqual([
      'data',
      'data.before-restore-20261006-110000Z',
    ]);
    expect(existsSync(path.join(r.previous as string, 'st4s.owner'))).toBe(false);
  });
  test('declined → nothing changes', async () => {
    const { file } = await backupDb(undefined, { ...opts(), now: t1 });
    writeFileSync(path.join(data, 'base', 'marker'), 'v2');
    await expect(restoreDb(file, () => false, opts())).rejects.toThrow('dibatalkan');
    expect(readFileSync(path.join(data, 'base', 'marker'), 'utf8')).toBe('v2');
    expect(readdirSync(path.join(home, 'pg'))).toEqual(['data']);
  });
  test('rejects archives escaping data/, with links, or without a manifest', async () => {
    const src = mkdtempSync(path.join(os.tmpdir(), 'st4s-evil-'));
    try {
      mkdirSync(path.join(src, 'data'));
      writeFileSync(path.join(src, 'data', 'PG_VERSION'), '17\n');
      const make = async (name: string, ...entries: string[]) => {
        const f = path.join(home, name);
        await tar(['-czf', f, '-C', src, ...entries]);
        return f;
      };
      const noManifest = await make('a.tar.gz', 'data');
      await expect(restoreDb(noManifest, yes, opts())).rejects.toThrow('st4s-backup.json');
      symlinkSync('/etc', path.join(src, 'data', 'l'));
      const link = await make('b.tar.gz', 'data');
      await expect(restoreDb(link, yes, opts())).rejects.toThrow('link');
      rmSync(path.join(src, 'data', 'l'));
      writeFileSync(path.join(src, 'x'), 'x');
      const outside = await make('c.tar.gz', 'data', 'x');
      await expect(restoreDb(outside, yes, opts())).rejects.toThrow('di luar data/');
      expect(readFileSync(path.join(data, 'base', 'marker'), 'utf8')).toBe('v1');
      expect(readdirSync(path.join(home, 'pg'))).toEqual(['data']);
    } finally {
      rmSync(src, { recursive: true, force: true });
    }
  });
  test('wrong major in manifest is refused before touching data', async () => {
    const { file } = await backupDb(undefined, { ...opts(), now: t1 });
    const src = mkdtempSync(path.join(os.tmpdir(), 'st4s-major-'));
    try {
      await tar(['-xzf', file, '-C', src]);
      const m = JSON.parse(readFileSync(path.join(src, 'st4s-backup.json'), 'utf8'));
      writeFileSync(path.join(src, 'st4s-backup.json'), JSON.stringify({ ...m, pgMajor: 16 }));
      const f = path.join(home, 'pg16.tar.gz');
      await tar(['-czf', f, '-C', src, 'st4s-backup.json', 'data']);
      await expect(restoreDb(f, yes, opts())).rejects.toThrow('PostgreSQL 16');
      expect(readdirSync(path.join(home, 'pg'))).toEqual(['data']);
    } finally {
      rmSync(src, { recursive: true, force: true });
    }
  });
});
