/**
 * `st4s db backup/restore` against the real built-in Postgres in a temp ST4S_HOME:
 * init → marker → backup → change marker → refused while running → restore --yes → marker is back.
 * Runtime from ST4S_PG_TEST_RUNTIME or the dev cache (data/pg-runtime); never downloaded here.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { processesWith } from '../../scripts/smoke-coldboot';
import { PG_RELEASE } from '../../server/local-pg/paths';
import { detectPlatform } from '../../server/local-pg/runtime';

const ROOT = path.resolve(import.meta.dir, '../..');
const detected = detectPlatform();
const runtime =
  process.env.ST4S_PG_TEST_RUNTIME ||
  ('platform' in detected ? path.join(ROOT, 'data/pg-runtime', PG_RELEASE, detected.platform) : '');
const available = Boolean(runtime) && existsSync(path.join(runtime, 'bin/postgres'));

const tmp = mkdtempSync(path.join(os.tmpdir(), 'st4s-backup-sidecar-'));
const home = path.join(tmp, 'st4s home');
const env = {
  PATH: process.env.PATH ?? '/usr/bin:/bin',
  HOME: process.env.HOME ?? tmp,
  ST4S_HOME: home,
  ST4S_PG_RUNTIME: runtime,
  NODE_ENV: 'production',
};
const ps = () =>
  processesWith(Bun.spawnSync(['ps', '-axo', 'pid=,ppid=,rss=,command=']).stdout.toString(), home);

async function run(args: string[]) {
  const p = Bun.spawn(['bun', ...args], { cwd: home, env, stdout: 'pipe', stderr: 'pipe' });
  const [code, out, err] = await Promise.all([
    p.exited,
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  return { code, out: out + err, json: () => JSON.parse(out.trim().split('\n').at(-1) ?? '') };
}
const cli = (...args: string[]) => run([path.join(ROOT, 'server/binary-entry.ts'), ...args]);
const exec = (sql: string) => run([path.join(import.meta.dir, 'sidecar-probe.ts'), 'exec', sql]);
const marker = `m-${crypto.randomUUID()}`;

afterAll(() => {
  for (const p of ps()) process.kill(p.pid, 'SIGKILL'); // only processes rooted in our temp home
  rmSync(tmp, { recursive: true, force: true });
});

describe.skipIf(!available)('st4s db backup/restore (PostgreSQL bawaan asli)', () => {
  test('backup → change → refused while running → restore brings the marker back', async () => {
    await Bun.write(path.join(home, '.keep'), '');
    expect((await cli('init')).code).toBe(0);
    const set = await exec(`create table backup_marker as select '${marker}'::text as v`);
    expect(set.code).toBe(0);

    const backup = await cli('db', 'backup');
    expect(backup.out).toContain('Backup selesai');
    expect(backup.code).toBe(0);
    const [file] = readdirSync(path.join(home, 'backups'));
    expect(file).toMatch(/^st4s-db-\d{8}-\d{6}Z\.tar\.gz$/);
    const archive = path.join(home, 'backups', file as string);

    const changed = await exec(`update backup_marker set v = 'changed' returning v`);
    expect(changed.json()).toEqual({ v: 'changed' });

    const holder = Bun.spawn(['bun', path.join(import.meta.dir, 'sidecar-probe.ts'), 'hold'], {
      cwd: home,
      env,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const reader = holder.stdout.getReader();
    let out = '';
    while (!out.includes('READY')) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`holder exit ${await holder.exited}`);
      out += new TextDecoder().decode(value);
    }
    for (const args of [
      ['db', 'backup'],
      ['db', 'restore', archive, '--yes'],
    ]) {
      const busy = await cli(...args);
      expect(busy.code).toBe(1);
      expect(busy.out).toContain('Hentikan st4s dulu');
    }
    holder.kill('SIGKILL');
    await holder.exited;
    const orphan = await cli('db', 'backup'); // owner gone, postmaster still up
    expect(orphan.out).toContain('masih berjalan');
    expect(orphan.code).toBe(1);
    expect((await cli('migrate')).code).toBe(0); // the hint: stops the orphan
    expect(readdirSync(path.join(home, 'backups'))).toEqual([file as string]);

    const restore = await cli('db', 'restore', archive, '--yes');
    expect(restore.out).toContain('Restore selesai');
    expect(restore.code).toBe(0);
    const before = readdirSync(path.join(home, 'pg')).filter((n) =>
      n.startsWith('data.before-restore-'),
    );
    expect(before).toHaveLength(1);
    expect(restore.out).toContain(before[0] as string);

    const back = await exec('select v from backup_marker');
    expect(back.code).toBe(0);
    expect(back.json()).toEqual({ v: marker });
    expect(ps()).toEqual([]);
  }, 180_000);
});
