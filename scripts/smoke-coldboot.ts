/**
 * Cold-boot smoke for the built-in Postgres: an empty ST4S_HOME (path with a space), a clean env
 * without DATABASE_URL, then `init` → `migrate` → `doctor` → server → black-box checks → SIGTERM,
 * and finally no process may still reference the temp home.
 *
 *   bun scripts/smoke-coldboot.ts ./st4s
 *   bun scripts/smoke-coldboot.ts bun server/binary-entry.ts
 *
 * ST4S_PG_ARCHIVE (cached zonky jar) or ST4S_PG_RUNTIME are passed through to skip the download.
 */
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runChecks } from './smoke-server.checks';

const STEP_TIMEOUT_MS = Number(process.env.SMOKE_INIT_TIMEOUT_MS ?? 300_000);
const BOOT_TIMEOUT_MS = 60_000;
const STOP_TIMEOUT_MS = 15_000;

type Proc = { pid: number; ppid: number; rssKb: number };

/**
 * From `ps -axo pid=,ppid=,rss=,command=`: processes whose command line contains `marker`, plus
 * their children (postgres backends retitle themselves and lose the data dir from argv).
 */
export function processesWith(psText: string, marker: string): Proc[] {
  const rows = psText
    .split('\n')
    .map((l) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), rssKb: Number(m[3]), cmd: m[4] ?? '' }));
  const roots = new Set(rows.filter((r) => r.cmd.includes(marker)).map((r) => r.pid));
  return rows
    .filter((r) => roots.has(r.pid) || roots.has(r.ppid))
    .map(({ pid, ppid, rssKb }) => ({ pid, ppid, rssKb }));
}

const ps = (marker: string) =>
  processesWith(
    Bun.spawnSync(['ps', '-axo', 'pid=,ppid=,rss=,command=']).stdout.toString(),
    marker,
  );

/** Runs one subcommand; `mayFail` is for doctor, which fails on the models/libs a smoke home never has. */
async function step(
  cmd: string[],
  args: string[],
  cwd: string,
  env: Record<string, string>,
  mayFail = false,
) {
  const t0 = Date.now();
  const proc = Bun.spawn([...cmd, ...args], { cwd, env, stdout: 'pipe', stderr: 'pipe' });
  const timer = setTimeout(() => proc.kill(), STEP_TIMEOUT_MS);
  const [code, out, err] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  clearTimeout(timer);
  const ms = Date.now() - t0;
  console.log(`${code === 0 ? '✅' : mayFail ? 'ℹ️ ' : '❌'} ${args[0]} (exit ${code}, ${ms} ms)`);
  if (code !== 0 && !mayFail) console.error(out, err);
  return { code, out: out + err };
}

async function main(): Promise<number> {
  // Steps run with cwd = the temp home, so relative paths (./st4s, server/binary-entry.ts) are resolved first.
  const cmd = process.argv.slice(2).map((a) => (existsSync(a) ? path.resolve(a) : a));
  if (cmd.length === 0) {
    console.error('Pemakaian: bun scripts/smoke-coldboot.ts <perintah st4s…>');
    return 2;
  }
  const root = await mkdtemp(path.join(tmpdir(), 'st4s-coldboot-'));
  const home = path.join(root, 'st4s home');
  const port = 3090 + Math.floor(Math.random() * 500);
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: process.env.HOME ?? root,
    ST4S_HOME: home,
    PORT: String(port),
    NODE_ENV: 'production',
  };
  for (const k of ['ST4S_PG_ARCHIVE', 'ST4S_PG_RUNTIME'])
    if (process.env[k]) env[k] = process.env[k] as string;
  let server: ReturnType<typeof Bun.spawn> | undefined;
  try {
    console.log(`ST4S_HOME="${home}"  PORT=${port}\n`);
    await Bun.write(path.join(home, '.keep'), '');
    for (const sub of ['init', 'migrate']) {
      const r = await step(cmd, [sub], home, env);
      if (r.code !== 0) return 1;
      if (sub === 'migrate' && !r.out.includes('0 diterapkan')) {
        console.error('❌ migrate kedua seharusnya tidak menerapkan apa pun');
        return 1;
      }
    }
    const doctor = await step(cmd, ['doctor'], home, env, true);
    for (const l of doctor.out.split('\n').filter((l) => /Postgres|DATABASE_URL/.test(l)))
      console.log(`   ${l}`);

    const t0 = Date.now();
    const proc = Bun.spawn(cmd, { cwd: home, env, stdout: 'pipe', stderr: 'pipe' });
    server = proc;
    const base = `http://localhost:${port}`;
    let up = false;
    while (!up && proc.exitCode === null && Date.now() - t0 < BOOT_TIMEOUT_MS) {
      up = (await fetch(`${base}/api/version`).catch(() => null))?.ok ?? false; // not listening yet
      if (!up) await Bun.sleep(200);
    }
    if (!up) {
      console.error(
        `❌ server tidak siap dalam ${BOOT_TIMEOUT_MS / 1000}s (exit ${proc.exitCode})`,
      );
      proc.kill();
      console.error(await new Response(proc.stderr).text());
      return 1;
    }
    console.log(`✅ server siap dalam ${Date.now() - t0} ms → ${base}`);
    await Bun.sleep(2000);
    const rssMb = Math.round(ps(path.join(home, 'pg')).reduce((s, p) => s + p.rssKb, 0) / 1024);
    console.log(`   RSS Postgres (semua proses) setelah idle 2 s: ${rssMb} MB\n`);

    const results = await runChecks(base);
    for (const r of results) console.log(`${r.ok ? '✅' : '❌'} ${r.name.padEnd(42)} ${r.detail}`);
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} pemeriksaan lulus\n`);

    proc.kill('SIGTERM');
    const exited = await Promise.race([
      proc.exited.then(() => true),
      Bun.sleep(STOP_TIMEOUT_MS).then(() => false),
    ]);
    if (!exited) {
      console.error(`❌ server tidak berhenti dalam ${STOP_TIMEOUT_MS / 1000}s setelah SIGTERM`);
      return 1;
    }
    server = undefined;
    const left = ps(home);
    console.log(
      `${left.length ? '❌' : '✅'} SIGTERM → exit ${proc.exitCode}; proses tersisa: ${left.map((p) => p.pid).join(' ') || 'tidak ada'}`,
    );
    return failed || left.length ? 1 : 0;
  } finally {
    if (server?.exitCode === null) {
      server.kill('SIGKILL');
      await server.exited;
    }
    await rm(root, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    process.exit(await main());
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
