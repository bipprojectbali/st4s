/**
 * The real built-in Postgres, end to end, in a temp ST4S_HOME with a space and a non-UTC host TZ:
 * init (initdb + all migrations) → query → reuse by `migrate` → second owner refused → kill -9 → recovery.
 * Runtime comes from ST4S_PG_TEST_RUNTIME or the dev cache (data/pg-runtime); never downloaded here.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { processesWith } from '../../scripts/smoke-coldboot';
import journal from '../../server/db/migrations/meta/_journal.json';
import { socketDirFor } from '../../server/local-pg/claim';
import { PG_RELEASE } from '../../server/local-pg/paths';
import { detectPlatform } from '../../server/local-pg/runtime';

const ROOT = path.resolve(import.meta.dir, '../..');
const detected = detectPlatform();
const runtime =
  process.env.ST4S_PG_TEST_RUNTIME ||
  ('platform' in detected ? path.join(ROOT, 'data/pg-runtime', PG_RELEASE, detected.platform) : '');
const available = Boolean(runtime) && existsSync(path.join(runtime, 'bin/postgres'));
const SKIP_REASON = `runtime Postgres tidak ada di ${runtime || '(platform tak didukung)'} — jalankan \`bun run dev\` sekali atau set ST4S_PG_TEST_RUNTIME`;
const TOTAL = journal.entries.length;

const tmp = mkdtempSync(path.join(os.tmpdir(), 'st4s-sidecar-'));
const home = path.join(tmp, 'st4s home');
const env = {
  PATH: process.env.PATH ?? '/usr/bin:/bin',
  HOME: process.env.HOME ?? tmp,
  ST4S_HOME: home,
  ST4S_PG_RUNTIME: runtime,
  TZ: 'America/New_York',
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
const cli = (sub: string) => run([path.join(ROOT, 'server/binary-entry.ts'), sub]);
const probe = (mode = 'query') => run([path.join(import.meta.dir, 'sidecar-probe.ts'), mode]);

afterAll(() => {
  // Only processes rooted in our own temp home (ours by construction).
  for (const p of ps()) process.kill(p.pid, 'SIGKILL');
  rmSync(tmp, { recursive: true, force: true });
});

describe.skipIf(!available)(
  `PostgreSQL bawaan (asli)${available ? '' : ` — SKIP: ${SKIP_REASON}`}`,
  () => {
    test('init: initdb + every migration; host TZ does not leak (session stays UTC)', async () => {
      await Bun.write(path.join(home, '.keep'), '');
      const init = await cli('init');
      expect(init.out).toContain(`${TOTAL} diterapkan, ${TOTAL} total`);
      expect(init.code).toBe(0);
      const q = await probe();
      expect(q.code).toBe(0);
      expect(q.json()).toEqual({
        tz: 'UTC',
        usr: 'st4s',
        migrations: TOTAL,
      });
      expect(ps()).toEqual([]);
    }, 120_000);

    test('running owner: migrate reuses it, a second owner is refused, kill -9 is recovered', async () => {
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
      const pidFile = await Bun.file(path.join(home, 'pg/data/postmaster.pid')).text();
      const pgPid = Number(pidFile.split('\n')[0]);
      expect(pgPid).toBeGreaterThan(0);

      const mig = await cli('migrate');
      expect(mig.out).toContain(`0 diterapkan, ${TOTAL} total`);
      expect(mig.code).toBe(0);
      expect(() => process.kill(pgPid, 0)).not.toThrow(); // migrate left the owner's sidecar running

      const second = await probe();
      expect(second.code).not.toBe(0);
      expect(second.out).toContain('sedang dipakai st4s lain');

      holder.kill('SIGKILL');
      await holder.exited;
      expect(() => process.kill(pgPid, 0)).not.toThrow(); // orphaned postmaster survives its owner

      const after = await probe();
      expect(after.code).toBe(0);
      expect(after.json().migrations).toBe(TOTAL);
      expect(ps()).toEqual([]);
      const dataDir = path.join(home, 'pg/data');
      const socketDir = socketDirFor(dataDir);
      if (socketDir !== dataDir) expect(existsSync(socketDir)).toBe(false); // /tmp fallback removed on stop
    }, 120_000);
  },
);
