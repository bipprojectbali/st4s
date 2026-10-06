/** Run the bundled postmaster as a child: atomic initdb, major check, owner claim, orphan cleanup, unix socket only, UTC. */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import {
  ensurePrivateDir,
  liveOwner,
  OWNER_FILE,
  type ProcInfo,
  postmasterVerdict,
  SOCKET_FILE,
  SOCKET_PORT,
  socketDirFor,
  systemProc,
  unidentifiedProcess,
  versionMismatch,
} from './claim';
import { PG_DATABASE, PG_USER } from './paths';
import { pgBin } from './runtime';

const cleanEnv = () => ({
  PATH: '/usr/bin:/bin',
  HOME: process.env.HOME ?? '/',
  LC_ALL: 'C',
  // The host TZ must never leak into the cluster: `timestamp` columns vs now() assume UTC.
  TZ: 'UTC',
});

function run(bin: string, args: string[]): string {
  const r = spawnSync(bin, args, { encoding: 'utf8', env: cleanEnv() });
  if (r.status !== 0)
    throw new Error(
      `${path.basename(bin)} gagal (exit ${r.status ?? r.signal}): ${(r.stderr || r.error?.message || '').trim()}`,
    );
  return r.stdout;
}

export const readOrNull = (file: string) => (existsSync(file) ? readFileSync(file, 'utf8') : null);

/** initdb into a sibling temp dir then rename, so an interrupted initdb never leaves a half-made data dir. */
function ensureCluster(runtime: string, dataDir: string): void {
  if (existsSync(path.join(dataDir, 'PG_VERSION'))) return;
  if (existsSync(dataDir) && readdirSync(dataDir).length > 0)
    throw new Error(`${dataDir} tidak kosong tetapi bukan data dir Postgres — pindahkan dulu.`);
  mkdirSync(path.dirname(dataDir), { recursive: true });
  const tmp = `${dataDir}.init-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  run(pgBin(runtime, 'initdb'), [
    '-D',
    tmp,
    '-U',
    PG_USER,
    '-E',
    'UTF8',
    '--locale=C',
    '--auth-local=trust',
    '--auth-host=reject',
    '--no-instructions',
  ]);
  rmSync(dataDir, { recursive: true, force: true });
  renameSync(tmp, dataDir);
}

/**
 * Refuse a live (or unidentifiable) owner/postmaster before touching anything; stop an orphan
 * postmaster left by a kill -9'd st4s; clear stale lock files.
 */
export function claimDataDir(
  runtime: string,
  dataDir: string,
  socketDir: string,
  proc: ProcInfo = systemProc,
): string {
  const ownerPath = path.join(dataDir, OWNER_FILE);
  const owner = liveOwner(readOrNull(ownerPath), proc);
  if (owner?.known)
    throw new Error(`Data dir ${dataDir} sedang dipakai st4s lain (PID ${owner.pid}).`);
  if (owner) throw new Error(unidentifiedProcess(owner.pid, dataDir, OWNER_FILE));
  const pidPath = path.join(dataDir, 'postmaster.pid');
  const pidFile = readOrNull(pidPath);
  const verdict = postmasterVerdict(pidFile, dataDir, proc);
  if (verdict === 'unknown')
    throw new Error(
      unidentifiedProcess(Number(pidFile?.split('\n')[0]), dataDir, 'postmaster.pid'),
    );
  // ponytail: two st4s starting in the same instant can both pass this; postgres' own postmaster.pid interlock stops the second.
  writeFileSync(ownerPath, `${process.pid} ${proc.started(process.pid)}\n`);

  if (verdict === 'running')
    run(pgBin(runtime, 'pg_ctl'), ['-D', dataDir, 'stop', '-m', 'fast', '-w', '-t', '30']);
  // Postgres itself only checks kill(pid, 0) on these, so a reused PID would block the start.
  if (verdict === 'stale') rmSync(pidPath, { force: true });
  for (const f of [SOCKET_FILE, `${SOCKET_FILE}.lock`])
    rmSync(path.join(socketDir, f), { force: true });
  return ownerPath;
}

/** Env that points the unchanged postgres-js client at the sidecar socket (a URL cannot carry a socket dir). */
export const socketEnv = (socketDir: string): Record<string, string> => ({
  DATABASE_URL: `postgres:///${PG_DATABASE}`,
  PGHOST: socketDir,
  PGPORT: String(SOCKET_PORT),
  PGUSER: PG_USER,
  // postgres-js prefers PGUSERNAME over PGUSER; a stray host value must not win.
  PGUSERNAME: PG_USER,
});

export type LocalPg = {
  pid: number;
  dataDir: string;
  socketDir: string;
  /** Points the unchanged postgres-js client at the socket: `postgres:///st4s` + PGHOST/PGPORT/PGUSER. */
  env: Record<string, string>;
  /** Fast shutdown (SIGINT), immediate (SIGQUIT) after `timeoutMs`, then release the owner file. */
  stop(timeoutMs?: number): Promise<void>;
};

type StartOpts = { runtime: string; dataDir: string; readyTimeoutMs?: number };

/** initdb if needed, start the postmaster on a private unix socket, wait for "ready", ensure the `st4s` DB. */
export async function startLocalPg({
  runtime,
  dataDir,
  readyTimeoutMs = 60_000,
}: StartOpts): Promise<LocalPg> {
  const binMajor = run(pgBin(runtime, 'postgres'), ['--version']).match(/(\d+)\.\d+/)?.[1] ?? '?';
  ensureCluster(runtime, dataDir);
  const dataMajor = readFileSync(path.join(dataDir, 'PG_VERSION'), 'utf8').trim();
  const mismatch = versionMismatch(dataDir, dataMajor, binMajor);
  if (mismatch) throw new Error(mismatch);
  const socketDir = socketDirFor(dataDir);
  if (socketDir !== dataDir) ensurePrivateDir(socketDir);
  const ownerPath = claimDataDir(runtime, dataDir, socketDir);
  const releaseOwner = () => {
    if (readOrNull(ownerPath)?.startsWith(`${process.pid} `)) rmSync(ownerPath, { force: true });
  };

  const log = openSync(path.join(dataDir, 'postmaster.log'), 'a');
  const proc = Bun.spawn(
    [
      pgBin(runtime, 'postgres'),
      '-D',
      dataDir,
      '-c',
      'listen_addresses=',
      '-c',
      `unix_socket_directories="${socketDir}"`,
      '-c',
      `port=${SOCKET_PORT}`,
      '-c',
      'max_connections=40',
      '-c',
      'shared_buffers=32MB',
      '-c',
      'timezone=UTC',
      '-c',
      'log_timezone=UTC',
    ],
    { cwd: dataDir, env: cleanEnv(), stdin: 'ignore', stdout: log, stderr: log },
  );
  const running = () => proc.exitCode === null && proc.signalCode === null;
  // Sync last resort (normal exit / process.exit): postgres finishes the fast shutdown on its own.
  const onExit = () => {
    if (running()) proc.kill('SIGINT');
    releaseOwner();
  };
  process.on('exit', onExit);

  try {
    const pidPath = path.join(dataDir, 'postmaster.pid');
    for (const t0 = Date.now(); ; await Bun.sleep(25)) {
      if (!running())
        throw new Error(
          `postgres berhenti saat start (exit ${proc.exitCode ?? proc.signalCode}) — lihat ${dataDir}/postmaster.log`,
        );
      // Line 8 of postmaster.pid is the postmaster status; "ready" once it accepts connections.
      const lines = readOrNull(pidPath)?.split('\n') ?? [];
      if (Number(lines[0]) === proc.pid && lines[7]?.trim() === 'ready') break;
      if (Date.now() - t0 > readyTimeoutMs)
        throw new Error(
          `postgres belum siap setelah ${readyTimeoutMs} ms — lihat ${dataDir}/postmaster.log`,
        );
    }
    const admin = postgres({
      host: socketDir,
      port: SOCKET_PORT,
      user: PG_USER,
      database: 'postgres',
      max: 1,
      onnotice: () => {},
    });
    try {
      const [row] = await admin`select 1 from pg_database where datname = ${PG_DATABASE}`;
      if (!row) await admin.unsafe(`create database "${PG_DATABASE}"`);
    } finally {
      await admin.end();
    }
  } catch (e) {
    process.off('exit', onExit);
    if (running()) proc.kill('SIGQUIT');
    await proc.exited;
    releaseOwner();
    throw e;
  }

  return {
    pid: proc.pid,
    dataDir,
    socketDir,
    env: socketEnv(socketDir),
    async stop(timeoutMs = 10_000) {
      process.off('exit', onExit);
      if (running()) {
        proc.kill('SIGINT');
        const t = setTimeout(() => running() && proc.kill('SIGQUIT'), timeoutMs);
        await proc.exited;
        clearTimeout(t);
      }
      releaseOwner();
      // Our private /tmp fallback (owner-checked 0700); postgres already removed its socket files.
      if (socketDir !== dataDir) rmSync(socketDir, { recursive: true, force: true });
    },
  };
}
