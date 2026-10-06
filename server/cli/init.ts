/** `st4s init`: create the ST4S_HOME folders and a 0600 `.env` (never overwritten, secrets never printed). */
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { st4sHome } from '../st4s-home';
import { runMigrate } from './migrate';

type Env = Record<string, string | undefined>;

/** The generated `.env`; SUPER_ADMIN_EMAILS is left for the user, DATABASE_URL is optional (empty = built-in Postgres). */
export function envTemplate(secret: string = randomBytes(32).toString('base64url')): string {
  return `# st4s — dibuat oleh \`st4s init\`. Variabel environment asli menang atas file ini.
NODE_ENV=production
PORT=3000
APP_URL=http://localhost:3000
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=${secret}

# Opsional: URL PostgreSQL ≥ 17 sendiri, contoh postgres://USER:PASSWORD@HOST:5432/st4s
# Kosong = st4s menjalankan PostgreSQL bawaan (data di <folder st4s>/pg/data, hanya unix socket).
DATABASE_URL=
# WAJIB diisi: email super-admin, pisahkan dengan koma
SUPER_ADMIN_EMAILS=

# Opsional
# MCP_ADMIN_TOKEN=        (minimal 32 karakter: openssl rand -hex 32)
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=
# FFMPEG_PATH=/opt/homebrew/bin/ffmpeg
# STT_THREADS=4
`;
}

/** Runs `st4s init`, then migrates (empty DATABASE_URL: installs and initializes the built-in Postgres first). */
export async function runInit(
  env: Env = process.env,
  migrate: (env: Env) => Promise<number> = runMigrate,
): Promise<number> {
  const home = st4sHome(env);
  if (!home) {
    console.error('❌ Folder st4s tidak diketahui — set ST4S_HOME atau jalankan dari binary st4s.');
    return 1;
  }
  for (const dir of ['', 'lib', 'models', 'logs'])
    mkdirSync(path.join(home, dir), { recursive: true });
  console.log(`✅ Folder siap: ${home} (lib/, models/, logs/)`);

  const envFile = path.join(home, '.env');
  if (existsSync(envFile)) {
    console.log(`ℹ️  ${envFile} sudah ada — tidak ditimpa.`);
  } else {
    writeFileSync(envFile, envTemplate(), { mode: 0o600, flag: 'wx' });
    chmodSync(envFile, 0o600);
    console.log(`✅ ${envFile} dibuat (mode 0600, BETTER_AUTH_SECRET acak).`);
    console.log('   Isi SUPER_ADMIN_EMAILS di file itu (DATABASE_URL opsional).');
  }

  const bin = path.join(home, 'st4s');
  const code = await migrate(env);
  if (code !== 0) return code;
  console.log(`\nLangkah berikutnya:
  ${bin} models pull          (atau: ${bin} models import <folder>)
  ${bin} doctor
  ${bin}`);
  return 0;
}
