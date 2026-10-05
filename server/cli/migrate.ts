/** `st4s migrate`, the binary boot guard and doctor's DB check. Uses DATABASE_URL only (no server/env.ts). */
import path from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

type Env = Record<string, string | undefined>;
export type MigrationState = { total: number; pending: number };

/** Binary: embedded via `--asset ./server/db/migrations` (VFS strips the parents → `/$bunfs/root/migrations`). */
export function migrationsFolder(standalone: boolean = Bun.isStandaloneExecutable): string {
  return standalone
    ? path.join(import.meta.dir, 'migrations')
    : path.join(import.meta.dir, '../db/migrations');
}

const connect = (url: string) => postgres(url, { max: 1, connect_timeout: 10, onnotice: () => {} });

/** Same rule drizzle's migrator applies: a file is pending when newer than the last applied `created_at`. */
export async function migrationState(
  url: string,
  folder: string = migrationsFolder(),
): Promise<MigrationState> {
  const files = readMigrationFiles({ migrationsFolder: folder });
  const sql = connect(url);
  try {
    const [t] = await sql`select to_regclass('drizzle.__drizzle_migrations') is not null as ok`;
    let last: number | null = null;
    if (t?.ok) {
      const [row] =
        await sql`select max(created_at)::bigint as last from drizzle.__drizzle_migrations`;
      last = row?.last == null ? null : Number(row.last);
    }
    const pending = files.filter((m) => last === null || last < m.folderMillis).length;
    return { total: files.length, pending };
  } finally {
    await sql.end();
  }
}

/** Apply pending migrations; prints the applied count. Exit code 0 on success. */
export async function runMigrate(env: Env = process.env): Promise<number> {
  const url = env.DATABASE_URL?.trim();
  if (!url) {
    console.error('❌ DATABASE_URL belum di-set — isi di .env (lihat `st4s doctor`), lalu ulangi.');
    return 1;
  }
  const folder = migrationsFolder();
  const sql = connect(url);
  try {
    const before = await migrationState(url, folder);
    await migrate(drizzle(sql), { migrationsFolder: folder });
    const after = await migrationState(url, folder);
    console.log(
      `✅ Migrasi selesai: ${before.pending - after.pending} diterapkan, ${after.total} total.`,
    );
    return 0;
  } catch (e) {
    console.error(`❌ Gagal migrasi database: ${(e as Error).message}`);
    return 1;
  } finally {
    await sql.end();
  }
}

/** Binary boot: null when the server may start, else the message to print before exiting 1. */
export async function bootMigrationError(env: Env = process.env): Promise<string | null> {
  const url = env.DATABASE_URL?.trim();
  if (!url)
    return 'DATABASE_URL belum di-set — jalankan `st4s init`, isi .env, lalu `st4s doctor`.';
  let state: MigrationState;
  try {
    state = await migrationState(url);
  } catch (e) {
    return `Database tidak bisa dihubungi: ${(e as Error).message} — cek DATABASE_URL lalu \`st4s doctor\`.`;
  }
  return state.pending > 0
    ? `Database belum dimigrasi (${state.pending} migrasi tertunda) — jalankan \`st4s migrate\`.`
    : null;
}
