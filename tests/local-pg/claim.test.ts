/** Sidecar claim decisions: postmaster.pid liveness (pid + comm + data dir), owner PID reuse, socket fallback, major check. */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ensurePrivateDir,
  liveOwner,
  type ProcInfo,
  postmasterVerdict,
  SOCKET_FILE,
  socketDirFor,
  statStartTime,
  versionMismatch,
} from '../../server/local-pg/claim';
import { claimDataDir } from '../../server/local-pg/server';

const fakeProc = (table: Record<number, { comm: string; started: string }>): ProcInfo => ({
  alive: (pid) => pid in table,
  comm: (pid) => table[pid]?.comm ?? '',
  started: (pid) => table[pid]?.started ?? '',
});

let tmp = '';
beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'st4s-claim-'));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const pidFile = (pid: number, dir: string) =>
  `${pid}\n${dir}\n1700000000\n5432\n/s\n\n  1  2\nready\n`;

describe('postmasterVerdict', () => {
  const proc = fakeProc({
    11: { comm: '/rt/bin/postgres', started: 'x' },
    22: { comm: '/usr/bin/ssh', started: 'y' },
    55: { comm: '', started: '' },
  });
  test('no file → none', () => expect(postmasterVerdict(null, tmp, proc)).toBe('none'));
  test('live postgres on this data dir → running (orphan after kill -9)', () => {
    expect(postmasterVerdict(pidFile(11, tmp), tmp, proc)).toBe('running');
  });
  test('dead PID, garbage or a non-postgres PID (reused after reboot) → stale', () => {
    expect(postmasterVerdict(pidFile(99, tmp), tmp, proc)).toBe('stale');
    expect(postmasterVerdict('garbage', tmp, proc)).toBe('stale');
    expect(postmasterVerdict(pidFile(22, tmp), tmp, proc)).toBe('stale');
  });
  test('postgres alive but serving another data dir → stale', () => {
    expect(postmasterVerdict(pidFile(11, '/elsewhere/data'), tmp, proc)).toBe('stale');
  });
  test('alive but comm unreadable → unknown, never stale', () => {
    expect(postmasterVerdict(pidFile(55, tmp), tmp, proc)).toBe('unknown');
  });
  test('same dir through a symlink still counts', () => {
    const link = path.join(tmp, 'link');
    symlinkSync(tmp, link);
    expect(postmasterVerdict(pidFile(11, link), tmp, proc)).toBe('running');
  });
});

describe('liveOwner', () => {
  const proc = fakeProc({ 33: { comm: 'bun', started: 'Mon Oct  6 10:00:00 2026' } });
  test('live owner with the same start time is returned', () => {
    expect(liveOwner('33 Mon Oct  6 10:00:00 2026\n', proc, 1)).toEqual({ pid: 33, known: true });
  });
  test('live PID with an unreadable or unrecorded start time is never free', () => {
    const blind = fakeProc({ 33: { comm: 'bun', started: '' } });
    expect(liveOwner('33 Mon Oct  6 10:00:00 2026', blind, 1)).toEqual({ pid: 33, known: false });
    expect(liveOwner('33 \n', proc, 1)).toEqual({ pid: 33, known: false });
    expect(liveOwner('44 \n', proc, 1)).toBeNull();
  });
  test('reused PID (different start time), dead PID, ourselves or garbage → free', () => {
    expect(liveOwner('33 Sun Oct  5 09:00:00 2026', proc, 1)).toBeNull();
    expect(liveOwner('44 Mon Oct  6 10:00:00 2026', proc, 1)).toBeNull();
    expect(liveOwner('33 Mon Oct  6 10:00:00 2026', proc, 33)).toBeNull();
    expect(liveOwner('nonsense', proc, 1)).toBeNull();
    expect(liveOwner(null, proc, 1)).toBeNull();
  });
  test('the real process table recognises this process as a live owner', async () => {
    const { systemProc } = await import('../../server/local-pg/claim');
    expect(liveOwner(`${process.pid} ${systemProc.started(process.pid)}`, systemProc, 1)).toEqual({
      pid: process.pid,
      known: true,
    });
  });
});

describe('claimDataDir', () => {
  const proc = fakeProc({
    55: { comm: '', started: '' },
    66: { comm: 'bun', started: '' },
  });
  const write = (name: string, body: string) => writeFileSync(path.join(tmp, name), body);
  const claim = () => claimDataDir('/no/runtime', tmp, tmp, proc);

  test('live postmaster with unreadable comm → refused, lock and socket untouched', () => {
    write('postmaster.pid', pidFile(55, tmp));
    write('.s.PGSQL.5432', '');
    expect(claim).toThrow('Tidak bisa memastikan proses PID 55');
    expect(readFileSync(path.join(tmp, 'postmaster.pid'), 'utf8')).toBe(pidFile(55, tmp));
    expect(existsSync(path.join(tmp, '.s.PGSQL.5432'))).toBe(true);
    expect(existsSync(path.join(tmp, 'st4s.owner'))).toBe(false);
  });
  test('live owner with unreadable start time → refused, owner file untouched', () => {
    write('st4s.owner', '66 Mon Oct  6 10:00:00 2026\n');
    expect(claim).toThrow('Tidak bisa memastikan proses PID 66');
    expect(claim).toThrow('st4s.owner');
    expect(readFileSync(path.join(tmp, 'st4s.owner'), 'utf8')).toBe(
      '66 Mon Oct  6 10:00:00 2026\n',
    );
  });
  test('dead postmaster and dead owner → stale lock removed, claimed by us', () => {
    write('postmaster.pid', pidFile(99, tmp));
    write('st4s.owner', '98 whenever\n');
    expect(claim()).toBe(path.join(tmp, 'st4s.owner'));
    expect(existsSync(path.join(tmp, 'postmaster.pid'))).toBe(false);
  });
});

describe('statStartTime', () => {
  test('field 22 of /proc/<pid>/stat, even when comm holds spaces and parens', () => {
    const stat =
      '1234 (a) b c) S 1 1234 1234 0 -1 4194560 100 0 0 0 1 2 0 0 20 0 1 0 98765 1000 50\n';
    expect(statStartTime(stat)).toBe('98765');
  });
  test('unreadable stat → unknown', () => expect(statStartTime('')).toBe(''));
});

describe('socketDirFor', () => {
  test('short data dir hosts its own socket', () => {
    expect(socketDirFor('/home/u/st4s/pg/data', 501)).toBe('/home/u/st4s/pg/data');
  });
  test('path past sun_path headroom → stable private /tmp dir per data dir', () => {
    const long = `/Users/someone/${'very-long-folder-name/'.repeat(4)}pg/data`;
    expect(Buffer.byteLength(path.join(long, SOCKET_FILE))).toBeGreaterThan(90);
    const dir = socketDirFor(long, 501);
    expect(dir).toMatch(/^\/tmp\/st4s-501-[0-9a-f]{12}$/);
    expect(socketDirFor(long, 501)).toBe(dir);
    expect(socketDirFor(`${long}2`, 501)).not.toBe(dir);
  });
  test('a quote or comma (breaks unix_socket_directories) also falls back', () => {
    expect(socketDirFor('/h/a,b/data', 501)).toStartWith('/tmp/st4s-501-');
    expect(socketDirFor('/h/a"b/data', 501)).toStartWith('/tmp/st4s-501-');
  });
});

describe('ensurePrivateDir', () => {
  const uid = process.getuid?.() ?? 0;
  test('creates 0700 and tightens an existing 0755', () => {
    const dir = path.join(tmp, 'sock');
    ensurePrivateDir(dir, uid);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    rmSync(dir, { recursive: true });
    mkdirSync(dir, { mode: 0o755 });
    ensurePrivateDir(dir, uid);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });
  test('refuses a symlink or a dir owned by another uid', () => {
    const real = path.join(tmp, 'real');
    mkdirSync(real);
    const link = path.join(tmp, 'link');
    symlinkSync(real, link);
    expect(() => ensurePrivateDir(link, uid)).toThrow('bukan milik user ini');
    expect(() => ensurePrivateDir(real, uid + 1)).toThrow('bukan milik user ini');
  });
});

describe('versionMismatch', () => {
  test('same major → null; other major → refusal with instructions', () => {
    expect(versionMismatch('/d', '17', '17')).toBeNull();
    const msg = versionMismatch('/d', '16', '17') ?? '';
    expect(msg).toContain('PostgreSQL 16');
    expect(msg).toContain('PostgreSQL 17');
    expect(msg).toContain('DATABASE_URL');
  });
});
