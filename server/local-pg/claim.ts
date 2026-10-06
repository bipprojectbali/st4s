/** Pure-ish decisions for the sidecar: is a postmaster/owner live, where the socket goes, does the data major match. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

// Only names the socket file `.s.PGSQL.5432`: listen_addresses='' means no TCP listener at all.
export const SOCKET_PORT = 5432;
export const SOCKET_FILE = `.s.PGSQL.${SOCKET_PORT}`;
export const OWNER_FILE = 'st4s.owner';
// sun_path is 104 (macOS) / 108 (Linux) bytes including NUL; keep headroom.
const MAX_SOCKET_PATH = 90;

/** Process lookups behind a seam so the pid/comm/stale decisions are unit-testable. */
export type ProcInfo = {
  alive(pid: number): boolean;
  /** Executable name or path (`ps -o comm=`; Linux `/proc/<pid>/comm`), '' when unknown. */
  comm(pid: number): string;
  /** Start time (`ps -o lstart=`; Linux boot ticks), '' when unknown; tells a reused PID apart. */
  started(pid: number): string;
};

const ps = (field: string, pid: number) =>
  spawnSync('ps', ['-o', `${field}=`, '-p', String(pid)], {
    encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
  }).stdout?.trim() ?? '';

const readProc = (pid: number, file: string) => {
  try {
    return readFileSync(`/proc/${pid}/${file}`, 'utf8');
  } catch {
    return ''; // process gone → unknown
  }
};

/** Field 22 (starttime, ticks since boot) of `/proc/<pid>/stat`; parsed after the last `)` since comm may hold spaces. */
export const statStartTime = (stat: string) =>
  stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] ?? '';

// Linux reads /proc: slim images (debian-slim, ubuntu) ship without procps, and an empty comm
// would mark a live postmaster stale and delete its lock file.
const linux = process.platform === 'linux';

export const systemProc: ProcInfo = {
  alive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === 'EPERM';
    }
  },
  comm: (pid) => (linux ? readProc(pid, 'comm').trim() : ps('comm', pid)),
  started: (pid) => (linux ? statStartTime(readProc(pid, 'stat')) : ps('lstart', pid)),
};

const samePath = (a: string, b: string) => {
  if (a === b) return true;
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false; // one side no longer exists → not the same dir
  }
};

/**
 * postmaster.pid → 'running' only when its PID is alive, is a `postgres` executable and the file's
 * data-dir line names this data dir; 'unknown' when the PID is alive but its name can't be read
 * (deleting the lock file under a live postmaster makes it shut down); anything else is stale.
 */
export function postmasterVerdict(
  pidFile: string | null,
  dataDir: string,
  proc: ProcInfo = systemProc,
): 'none' | 'running' | 'stale' | 'unknown' {
  if (pidFile === null) return 'none';
  const [pidLine, dirLine] = pidFile.split('\n');
  const pid = Number(pidLine);
  if (!Number.isInteger(pid) || pid <= 0 || !proc.alive(pid)) return 'stale';
  const comm = proc.comm(pid);
  if (comm === '') return 'unknown';
  if (path.basename(comm) !== 'postgres') return 'stale';
  return dirLine && samePath(dirLine.trim(), dataDir) ? 'running' : 'stale';
}

/**
 * st4s.owner holds `<pid> <start time>`; null when free/stale/ours. A live PID whose start time
 * can't be compared (either side unknown) is never free: `known: false`.
 */
export function liveOwner(
  ownerFile: string | null,
  proc: ProcInfo = systemProc,
  self = process.pid,
): { pid: number; known: boolean } | null {
  const m = ownerFile?.trim().match(/^(\d+)(?: (.+))?$/);
  if (!m) return null;
  const pid = Number(m[1]);
  if (pid === self || !proc.alive(pid)) return null;
  const started = proc.started(pid);
  if (!m[2] || started === '') return { pid, known: false };
  return started === m[2] ? { pid, known: true } : null;
}

/** Refusal when a live PID guards `lockFile` but can't be identified; the file is never deleted then. */
export const unidentifiedProcess = (pid: number, dataDir: string, lockFile: string) =>
  `Tidak bisa memastikan proses PID ${pid} bukan Postgres/st4s yang memakai data dir ${dataDir}. ` +
  'Pastikan tidak ada Postgres atau st4s lain yang memakai data dir ini, lalu ulangi. ' +
  `Bila PID itu jelas proses lain, hapus ${path.join(dataDir, lockFile)} lalu ulangi.`;

/** The data dir itself when the socket path fits sun_path, else a private `/tmp/st4s-<uid>-<hash>`. */
export function socketDirFor(dataDir: string, uid = process.getuid?.() ?? 0): string {
  const fits = Buffer.byteLength(path.join(dataDir, SOCKET_FILE)) <= MAX_SOCKET_PATH;
  if (fits && !/[",]/.test(dataDir)) return dataDir;
  const hash = createHash('sha256').update(dataDir).digest('hex').slice(0, 12);
  return path.join('/tmp', `st4s-${uid}-${hash}`);
}

/** Create (or accept) a 0700 dir owned by us; refuse symlinks and dirs owned by someone else. */
export function ensurePrivateDir(dir: string, uid = process.getuid?.() ?? 0): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = lstatSync(dir);
  if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== uid)
    throw new Error(`Folder socket ${dir} bukan milik user ini — hapus lalu ulangi.`);
  if ((st.mode & 0o077) !== 0) chmodSync(dir, 0o700);
}

/** Message for a data dir made by another Postgres major, or null when they match. */
export function versionMismatch(
  dataDir: string,
  dataMajor: string,
  binMajor: string,
): string | null {
  if (dataMajor === binMajor) return null;
  return (
    `Data dir ${dataDir} dibuat PostgreSQL ${dataMajor}, runtime st4s memakai PostgreSQL ${binMajor}. ` +
    `Upgrade otomatis belum ada: jalankan st4s versi lama (PostgreSQL ${dataMajor}) dan dump datanya, ` +
    'atau pindahkan folder itu ke cadangan agar st4s membuat database baru, atau set DATABASE_URL.'
  );
}
