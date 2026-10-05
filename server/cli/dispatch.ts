/** argv → command for the compiled binary, and loading `<ST4S_HOME>/.env`. Must not import server/env.ts. */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ENGINE_CHILD_FLAG } from '../engines/child-argv';
import { st4sHome } from '../st4s-home';

export type CliCommand =
  | 'engine-child'
  | 'init'
  | 'doctor'
  | 'migrate'
  | 'models'
  | 'version'
  | 'help'
  | 'server'
  | 'unknown';

const SUBCOMMANDS = new Set<CliCommand>(['init', 'doctor', 'migrate', 'models']);

/** Engine child wins over everything; none or an unknown `-flag` starts the server; an unknown word is an error. */
export function resolveCommand(argv: readonly string[]): CliCommand {
  const arg = argv[2];
  if (arg === ENGINE_CHILD_FLAG) return 'engine-child';
  if (arg === undefined) return 'server';
  if (SUBCOMMANDS.has(arg as CliCommand)) return arg as CliCommand;
  if (arg === '--version' || arg === '-v') return 'version';
  if (arg === '--help' || arg === '-h' || arg === 'help') return 'help';
  return arg.startsWith('-') ? 'server' : 'unknown';
}

/** Load `<home>/.env` (real env wins, cwd `.env` is never read). Returns the file loaded, or null. */
export function loadHomeEnv(env: Record<string, string | undefined> = process.env): string | null {
  const home = st4sHome(env);
  if (!home) return null;
  const file = path.join(home, '.env');
  if (!existsSync(file)) return null;
  process.loadEnvFile(file);
  return file;
}

export const HELP_TEXT = `Pemakaian: st4s [perintah]

  (tanpa perintah)   jalankan server
  init               siapkan folder ST4S_HOME dan .env (tidak menimpa yang sudah ada)
  doctor             periksa instalasi: .env, database, lib/, model, ffmpeg, karantina
  migrate            terapkan migrasi database
  models <…>         unduh/impor model (st4s models --help)
  --version          tampilkan versi
  --help             tampilkan bantuan ini

Folder dasar: $ST4S_HOME, atau folder tempat binary berada.`;
