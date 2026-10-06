/** Boot glue: with DATABASE_URL empty, install the runtime, start the sidecar and point process.env at it. Must not import server/env.ts. */
import path from 'node:path';
import { liveOwner, OWNER_FILE, postmasterVerdict, socketDirFor } from './claim';
import { isLocalPgMode, pgDataDir } from './paths';
import { ensureRuntime } from './runtime';
import { type LocalPg, readOrNull, socketEnv, startLocalPg } from './server';

type Env = Record<string, string | undefined>;

// globalThis survives `bun --hot` re-evaluation, so a reload reuses the running postmaster.
const g = globalThis as typeof globalThis & { __st4sLocalPg?: Promise<LocalPg> };

export type BootDeps = {
  start?: (env: Env) => Promise<LocalPg>;
  log?: (msg: string) => void;
};

const startFromEnv = async (env: Env) =>
  startLocalPg({ runtime: await ensureRuntime({ env }), dataDir: pgDataDir(env) });

/**
 * Start the built-in Postgres when DATABASE_URL is empty and inject DATABASE_URL/PG* into `env`;
 * returns null (and touches nothing) when DATABASE_URL is set. Idempotent per process.
 */
export async function bootLocalPg(
  env: Env = process.env,
  deps: BootDeps = {},
): Promise<LocalPg | null> {
  if (!isLocalPgMode(env)) return null;
  const log = deps.log ?? ((m: string) => console.error(`[st4s] ${m}`));
  if (!g.__st4sLocalPg) {
    log('menyiapkan database (PostgreSQL bawaan)…');
    const t0 = Date.now();
    g.__st4sLocalPg = (deps.start ?? startFromEnv)(env).then(
      (pg) => {
        log(`database siap dalam ${Date.now() - t0} ms (${pg.dataDir})`);
        return pg;
      },
      (e: Error) => {
        g.__st4sLocalPg = undefined;
        throw new Error(`PostgreSQL bawaan gagal start: ${e.message}`);
      },
    );
  }
  const pg = await g.__st4sLocalPg;
  Object.assign(env, pg.env);
  return pg;
}

/** Stop the sidecar this process started (no-op otherwise); safe to call twice. */
export async function stopLocalPg(): Promise<void> {
  const pending = g.__st4sLocalPg;
  g.__st4sLocalPg = undefined;
  if (pending) await (await pending).stop();
}

/**
 * For one-shot CLI commands (migrate/init): reuse the sidecar of a running st4s server, else start
 * one. Returns the cleanup to run afterwards — it never stops a sidecar owned by another process.
 */
export async function acquireLocalPg(env: Env = process.env): Promise<() => Promise<void>> {
  const none = async () => {};
  if (!isLocalPgMode(env)) return none;
  const dataDir = pgDataDir(env);
  const owner = liveOwner(readOrNull(path.join(dataDir, OWNER_FILE)));
  const up = postmasterVerdict(readOrNull(path.join(dataDir, 'postmaster.pid')), dataDir);
  if (owner && up === 'running') {
    Object.assign(env, socketEnv(socketDirFor(dataDir)));
    return none;
  }
  await bootLocalPg(env);
  return stopLocalPg;
}
