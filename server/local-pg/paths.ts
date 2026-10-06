/** Where the built-in Postgres runtime and data live. Env-free on purpose: runs before server/env.ts validates `.env`. */
import path from 'node:path';
import { expandHome, st4sHome } from '../st4s-home';

type Env = Record<string, string | undefined>;

/** Pinned zonky release; one Postgres major per st4s line (data dirs of another major are refused). */
export const PG_RELEASE = '17.11.0';
export const PG_MAJOR = '17';
/** Superuser created by initdb and database the server uses. */
export const PG_USER = 'st4s';
export const PG_DATABASE = 'st4s';

/** Local mode = DATABASE_URL empty or unset; a set URL keeps the external database untouched. */
export function isLocalPgMode(env: Env = process.env): boolean {
  return !env.DATABASE_URL?.trim();
}

/** `$ST4S_PG_RUNTIME`, else `<home>/lib/pg/<release>/<platform>`, else `./data/pg-runtime/<release>/<platform>` (dev). */
export function pgRuntimeDir(platform: string, env: Env = process.env): string {
  const raw = env.ST4S_PG_RUNTIME?.trim();
  if (raw) return expandHome(raw);
  const home = st4sHome(env);
  const base = home ? path.join(home, 'lib', 'pg') : path.resolve('data', 'pg-runtime');
  return path.join(base, PG_RELEASE, platform);
}

/** True when the runtime dir is user-managed (ST4S_PG_RUNTIME): st4s never downloads into or deletes it. */
export function pgRuntimeIsManual(env: Env = process.env): boolean {
  return Boolean(env.ST4S_PG_RUNTIME?.trim());
}

/** `$ST4S_PG_DATA`, else `<home>/pg/data`, else `./data/pg` (dev). */
export function pgDataDir(env: Env = process.env): string {
  const raw = env.ST4S_PG_DATA?.trim();
  if (raw) return expandHome(raw);
  const home = st4sHome(env);
  return home ? path.join(home, 'pg', 'data') : path.resolve('data', 'pg');
}
