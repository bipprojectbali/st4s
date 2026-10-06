/** Backup archive format: names, manifest, entry safety checks, and the system `tar` runner (argv, no shell). */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { st4sHome } from '../st4s-home';
import { PG_MAJOR } from './paths';

type Env = Record<string, string | undefined>;

export const MANIFEST_FILE = 'st4s-backup.json';
export const BACKUP_FORMAT = 1;
/** Never archived: live-instance lock/state files and sockets. */
export const EXCLUDED = ['postmaster.pid', 'postmaster.opts', 'st4s.owner', '.s.PGSQL.*'];

export type Manifest = {
  format: number;
  pgMajor: number;
  pgVersion: string;
  st4sVersion: string;
  createdAt: string;
};

/** `<home>/backups`, else `./data/backups` (dev, next to `./data/pg`). */
export function backupsDir(env: Env = process.env): string {
  const home = st4sHome(env);
  return home ? path.join(home, 'backups') : path.resolve('data', 'backups');
}

/** `20261006-153000Z` (UTC) — sorts chronologically as text. */
export const stamp = (d: Date) =>
  `${d.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')}Z`;

const NAME = /^st4s-db-(\d{8})-(\d{6})Z\.tar\.gz$/;
export const backupFileName = (d: Date) => `st4s-db-${stamp(d)}.tar.gz`;

/** Newest default-named backup in `dir` (readdir only) with its creation time from the name. */
export function newestBackup(dir: string): { name: string; at: Date } | null {
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => NAME.test(n));
  } catch {
    return null; // no backups dir yet
  }
  const name = names.sort().at(-1);
  const m = name?.match(NAME);
  if (!name || !m) return null;
  const [d, t] = [m[1] as string, m[2] as string];
  const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4)}Z`;
  return { name, at: new Date(iso) };
}

/** Error message for a bad manifest, or null when it can be restored by this runtime. */
export function manifestError(raw: string | null, major = PG_MAJOR): string | null {
  if (raw === null || raw.trim() === '')
    return `Arsip tidak berisi ${MANIFEST_FILE} — bukan backup st4s.`;
  let m: Partial<Manifest>;
  try {
    m = JSON.parse(raw);
  } catch {
    return `${MANIFEST_FILE} rusak (bukan JSON).`;
  }
  if (m?.format !== BACKUP_FORMAT)
    return `Format backup ${String(m?.format)} tidak dikenal (st4s ini membaca format ${BACKUP_FORMAT}) — pakai st4s versi yang membuat backup itu.`;
  if (String(m.pgMajor) !== major)
    return `Backup berasal dari PostgreSQL ${String(m.pgMajor)}, runtime st4s memakai PostgreSQL ${major}. Restore fisik hanya bisa ke major yang sama — pakai st4s versi yang cocok, atau pindahkan data lewat pg_dump.`;
  return null;
}

/**
 * Error for an archive whose entries could escape `data/` or are not plain files/dirs, else null.
 * `names` from `tar -tzf`, `verbose` from `tar -tzvf` (first char is the entry type on GNU and bsd tar).
 */
export function entriesError(names: string[], verbose: string[]): string | null {
  if (names.length !== verbose.length) return 'Daftar isi arsip tidak konsisten — arsip ditolak.';
  for (const [i, name] of names.entries()) {
    const type = verbose[i]?.[0];
    if (type !== '-' && type !== 'd')
      return `Arsip berisi link atau file khusus (${name}) — arsip ditolak.`;
    if (name === MANIFEST_FILE) continue;
    const segs = name.split('/');
    if (name.startsWith('/') || segs.includes('..') || segs[0] !== 'data')
      return `Arsip berisi path di luar data/ (${name}) — arsip ditolak.`;
  }
  if (!names.includes('data/PG_VERSION'))
    return 'Arsip tidak berisi data/PG_VERSION — bukan backup st4s.';
  return null;
}

// The running tar child, so an interrupt can stop it before cleanup.
let current: ReturnType<typeof Bun.spawn> | null = null;

/** Run the system tar; stdout goes to `outFd` when given. Throws with tar's stderr on failure. */
export async function tar(args: string[], outFd?: number): Promise<string> {
  const p = Bun.spawn(['tar', ...args], {
    // COPYFILE_DISABLE: macOS tar would add `._*` AppleDouble entries.
    env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', COPYFILE_DISABLE: '1' },
    stdin: 'ignore',
    stdout: outFd ?? 'pipe',
    stderr: 'pipe',
  });
  current = p;
  const [code, out, err] = await Promise.all([
    p.exited,
    outFd === undefined ? new Response(p.stdout as ReadableStream).text() : '',
    new Response(p.stderr).text(),
  ]);
  current = null;
  if (code !== 0) throw new Error(`tar gagal (exit ${code}): ${err.trim()}`);
  return out;
}

export const stopTar = () => current?.kill('SIGKILL');
