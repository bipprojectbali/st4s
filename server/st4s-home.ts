/** ST4S_HOME layout (bin, lib/, models/, logs/): resolved per call so tests and `.env` changes apply. */
import os from 'node:os';
import path from 'node:path';

type Env = Record<string, string | undefined>;

/** Expand a leading `~` and make the path absolute. */
export function expandHome(p: string): string {
  const expanded = p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p;
  return path.resolve(expanded);
}

/** `$ST4S_HOME` if non-empty; else the binary's own folder; null in dev (`bun run dev`/`start`). */
export function st4sHome(env: Env = process.env): string | null {
  const raw = env.ST4S_HOME?.trim();
  if (raw) return expandHome(raw);
  return Bun.isStandaloneExecutable ? path.dirname(process.execPath) : null;
}

/** `<home>/lib` (libcrispasr, libggml*, libonnxruntime), or null without a home. */
export function st4sLibDir(env: Env = process.env): string | null {
  const home = st4sHome(env);
  return home ? path.join(home, 'lib') : null;
}

/** `<home>/models` (stt/…, tts/…), or null without a home. */
export function st4sModelsDir(env: Env = process.env): string | null {
  const home = st4sHome(env);
  return home ? path.join(home, 'models') : null;
}

/** `<home>/logs`, or the cwd-relative `logs` used before ST4S_HOME existed. */
export function st4sLogsDir(env: Env = process.env): string {
  const home = st4sHome(env);
  return home ? path.join(home, 'logs') : 'logs';
}

/** File name of the CrispASR shared library on this platform. */
export const CRISPASR_LIB_FILE =
  process.platform === 'darwin' ? 'libcrispasr.dylib' : 'libcrispasr.so';
