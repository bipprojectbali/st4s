/** `st4s db backup|restore`: cold physical snapshot of the built-in Postgres data dir (same major only, no pg_dump). */
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pkg from '../../package.json' with { type: 'json' };
import {
  BACKUP_FORMAT,
  backupFileName,
  backupsDir,
  EXCLUDED,
  entriesError,
  MANIFEST_FILE,
  type Manifest,
  manifestError,
  stamp,
  stopTar,
  tar,
} from './archive';
import { liveOwner, OWNER_FILE, type ProcInfo, postmasterVerdict, systemProc } from './claim';
import { isLocalPgMode, PG_MAJOR, PG_RELEASE, pgDataDir } from './paths';
import { readOrNull } from './server';

type Env = Record<string, string | undefined>;
type Opts = { env?: Env; proc?: ProcInfo; now?: Date };

export const EXTERNAL_DB =
  '`st4s db backup/restore` hanya untuk PostgreSQL bawaan (DATABASE_URL kosong). DATABASE_URL terisi: ' +
  'backup database itu dengan pg_dump (mis. `pg_dump -Fc "$DATABASE_URL" -f st4s.dump`) dan pulihkan dengan pg_restore.';

/** Why the data dir can't be snapshotted/replaced now (live or unidentifiable owner/postmaster), or null. */
export function inUseError(dataDir: string, proc: ProcInfo = systemProc): string | null {
  const owner = liveOwner(readOrNull(path.join(dataDir, OWNER_FILE)), proc);
  const pidFile = readOrNull(path.join(dataDir, 'postmaster.pid'));
  const verdict = postmasterVerdict(pidFile, dataDir, proc);
  const pid = Number(pidFile?.split('\n')[0]);
  let why: string;
  if (owner?.known) why = `st4s PID ${owner.pid} sedang memakainya`;
  else if (owner)
    why = `proses PID ${owner.pid} memegang ${OWNER_FILE} dan tidak bisa dipastikan sudah berhenti`;
  else if (verdict === 'running')
    why = `Postgres PID ${pid} masih berjalan di data dir ini (bila st4s-nya sudah mati, \`st4s migrate\` sekali akan menghentikan sisa Postgres itu)`;
  else if (verdict === 'unknown')
    why = `proses PID ${pid} memegang postmaster.pid dan tidak bisa dipastikan bukan Postgres`;
  else return null;
  return `Data dir ${dataDir} sedang dipakai: ${why}. Hentikan st4s dulu (Ctrl+C di terminal server, atau \`kill <PID>\` lalu tunggu sampai keluar), lalu ulangi.`;
}

/**
 * Take st4s.owner like a server start does, so a start in the meantime is refused. A start that
 * checked just before our write overwrites the owner or brings up a postmaster: `verify()` catches both.
 */
function hold(dataDir: string, proc: ProcInfo) {
  const busy = inUseError(dataDir, proc);
  if (busy) throw new Error(busy);
  const ownerPath = path.join(dataDir, OWNER_FILE);
  const mine = `${process.pid} ${proc.started(process.pid)}\n`;
  writeFileSync(ownerPath, mine);
  return {
    verify() {
      const busy = inUseError(dataDir, proc);
      if (readOrNull(ownerPath) !== mine || busy)
        throw new Error(busy ?? `Data dir ${dataDir} diambil proses lain selama operasi — ulangi.`);
    },
    release(dir = dataDir) {
      const file = path.join(dir, OWNER_FILE);
      if (readOrNull(file) === mine) rmSync(file, { force: true });
    },
  };
}

/** Run `fn`; on SIGINT/SIGTERM stop tar, clean up and exit 130; `cleanup` also runs after `fn`. */
async function guarded<T>(cleanup: () => void, fn: () => Promise<T>): Promise<T> {
  const onSignal = () => {
    stopTar();
    cleanup();
    process.exit(130);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    return await fn();
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    cleanup();
  }
}

export type BackupResult = { file: string; bytes: number; ms: number };

/** Archive the stopped data dir to `out` (default `<backups>/st4s-db-<stamp>.tar.gz`), mode 0600, via `.partial` + rename. */
export async function backupDb(out?: string, opts: Opts = {}): Promise<BackupResult> {
  const env = opts.env ?? process.env;
  const proc = opts.proc ?? systemProc;
  const now = opts.now ?? new Date();
  const t0 = Date.now();
  if (!isLocalPgMode(env)) throw new Error(EXTERNAL_DB);
  const dataDir = pgDataDir(env);
  const dataMajor = readOrNull(path.join(dataDir, 'PG_VERSION'))?.trim();
  if (!dataMajor)
    throw new Error(
      `Belum ada data PostgreSQL bawaan di ${dataDir} — jalankan \`st4s init\` dulu.`,
    );

  const file = out ? path.resolve(out) : path.join(backupsDir(env), backupFileName(now));
  if (!path.relative(dataDir, file).startsWith('..'))
    throw new Error(`File backup tidak boleh berada di dalam data dir ${dataDir}.`);
  if (existsSync(file))
    throw new Error(`${file} sudah ada — backup tidak pernah menimpa; pilih nama lain.`);

  const lock = hold(dataDir, proc);
  const partial = `${file}.partial`;
  const stage = mkdtempSync(path.join(os.tmpdir(), 'st4s-backup-'));
  let done = false;
  const cleanup = () => {
    rmSync(stage, { recursive: true, force: true });
    if (!done) rmSync(partial, { force: true });
    lock.release();
  };
  return guarded(cleanup, async () => {
    if (!out) mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const manifest: Manifest = {
      format: BACKUP_FORMAT,
      pgMajor: Number(dataMajor),
      pgVersion: PG_RELEASE,
      st4sVersion: pkg.version,
      createdAt: now.toISOString(),
    };
    writeFileSync(path.join(stage, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
    // `data` → the real data dir, archived through `-h` so entries are `data/…` whatever the dir is called.
    symlinkSync(dataDir, path.join(stage, 'data'));
    rmSync(partial, { force: true });
    const fd = openSync(partial, 'wx', 0o600);
    try {
      const excludes = EXCLUDED.flatMap((p) => ['--exclude', `data/${p}`]);
      await tar(['-czh', ...excludes, '-f', '-', '-C', stage, MANIFEST_FILE, 'data'], fd);
    } finally {
      closeSync(fd);
    }
    lock.verify();
    renameSync(partial, file);
    done = true;
    return { file, bytes: statSync(file).size, ms: Date.now() - t0 };
  });
}

export type RestorePlan = {
  file: string;
  dataDir: string;
  previous: string | null;
  manifest: Manifest;
};
export type RestoreResult = RestorePlan & { ms: number; migrateHint: boolean };

const lines = (s: string) => s.split('\n').filter((l) => l !== '');

/**
 * Validate `file`, ask `confirm(plan)`, extract next to the data dir, then swap: the current data
 * dir moves to `<data>.before-restore-<stamp>` (never deleted) and is put back if the swap fails.
 */
export async function restoreDb(
  file: string,
  confirm: (plan: RestorePlan) => boolean,
  opts: Opts = {},
): Promise<RestoreResult> {
  const env = opts.env ?? process.env;
  const proc = opts.proc ?? systemProc;
  const now = opts.now ?? new Date();
  const t0 = Date.now();
  if (!isLocalPgMode(env)) throw new Error(EXTERNAL_DB);
  const src = path.resolve(file);
  if (!existsSync(src) || !statSync(src).isFile())
    throw new Error(`File backup ${src} tidak ditemukan.`);
  const dataDir = pgDataDir(env);

  const names = lines(await tar(['-tzf', src]));
  const bad = entriesError(names, lines(await tar(['-tzvf', src])));
  if (bad) throw new Error(bad);
  const raw = names.includes(MANIFEST_FILE) ? await tar(['-xzOf', src, MANIFEST_FILE]) : null;
  const badManifest = manifestError(raw);
  if (badManifest) throw new Error(badManifest);
  const manifest = JSON.parse(raw as string) as Manifest;

  const exists = existsSync(dataDir);
  const busy = exists ? inUseError(dataDir, proc) : null;
  if (busy) throw new Error(busy);
  const ts = stamp(now);
  const plan: RestorePlan = {
    file: src,
    dataDir,
    previous: exists ? `${dataDir}.before-restore-${ts}` : null,
    manifest,
  };
  if (!confirm(plan)) throw new Error('Restore dibatalkan — tidak ada yang diubah.');

  const lock = exists ? hold(dataDir, proc) : null;
  const tmp = `${dataDir}.restore-${ts}`;
  mkdirSync(path.dirname(dataDir), { recursive: true });
  mkdirSync(tmp, { mode: 0o700 });
  const cleanup = () => {
    rmSync(tmp, { recursive: true, force: true });
    lock?.release();
    if (plan.previous) lock?.release(plan.previous);
  };
  return guarded(cleanup, async () => {
    await tar(['-xzf', src, '-C', tmp]);
    const restored = path.join(tmp, 'data');
    const major = readOrNull(path.join(restored, 'PG_VERSION'))?.trim();
    if (major !== PG_MAJOR)
      throw new Error(
        `Isi backup PostgreSQL ${major}, runtime st4s PostgreSQL ${PG_MAJOR} — restore dibatalkan.`,
      );
    // Lock files from a foreign archive would make the next start refuse; this is our own temp copy.
    for (const f of ['postmaster.pid', 'postmaster.opts', OWNER_FILE])
      rmSync(path.join(restored, f), { force: true });
    chmodSync(restored, 0o700); // postgres refuses a data dir with group/other access
    lock?.verify();
    if (plan.previous) renameSync(dataDir, plan.previous);
    try {
      renameSync(restored, dataDir);
    } catch (e) {
      if (plan.previous) renameSync(plan.previous, dataDir);
      throw new Error(
        `Gagal memasang data hasil restore: ${(e as Error).message}. Data lama tetap di ${dataDir}.`,
      );
    }
    return { ...plan, ms: Date.now() - t0, migrateHint: manifest.st4sVersion !== pkg.version };
  });
}
