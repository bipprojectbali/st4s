/**
 * Dev DB tooling behind `bun run st4s|db:migrate|db:push|db:studio`. Refuses a DATABASE_URL that names a
 * `*_test` database. `drizzle-kit <cmd>` gets the built-in Postgres when DATABASE_URL is empty (reusing the
 * sidecar of a running `bun run dev`); any other argv runs the st4s CLI from source (server/binary-entry.ts).
 */
import { acquireLocalPg } from '../server/local-pg/boot';

type Env = Record<string, string | undefined>;
type Spawn = (cmd: string[], env: Env) => Promise<number>;

/** Why dev tooling must not touch this DATABASE_URL (a `*_test` database), or null. */
export function testDbError(env: Env): string | null {
  const url = env.DATABASE_URL?.trim();
  if (!url) return null;
  let name: string;
  try {
    // Same precedence as postgres-js: URL path, then PGDATABASE.
    name = decodeURIComponent(new URL(url).pathname.slice(1)) || env.PGDATABASE || '';
  } catch {
    return 'DATABASE_URL tidak valid — perbaiki di .env.';
  }
  return name.toLowerCase().endsWith('_test')
    ? `DATABASE_URL menunjuk database test "${name}" — perintah dev tidak boleh dijalankan ke database test. Kosongkan DATABASE_URL (PostgreSQL bawaan) atau isi URL database dev.`
    : null;
}

/** Why this st4s subcommand must not run from source, or null. */
export function sourceCliError(args: string[]): string | null {
  if (args[0] === undefined)
    return 'Dari source, jalankan server dengan `bun run dev` (atau `bun run start`); `bun run st4s <perintah>` hanya untuk subcommand.';
  if (args[0] === 'init')
    return '`st4s init` hanya untuk binary (membuat ST4S_HOME dan .env-nya). Di dev: `bun run db:migrate` (PostgreSQL bawaan di ./data/pg bila DATABASE_URL kosong), lalu `bun run dev`.';
  return null;
}

const spawnArgv: Spawn = async (cmd, env) => {
  const child = Bun.spawn(cmd, { env, stdio: ['inherit', 'inherit', 'inherit'] });
  // Ctrl+C must stop drizzle-kit, not us: the sidecar is released only after the child exits.
  const forward = (sig: NodeJS.Signals) => () => child.kill(sig);
  const onInt = forward('SIGINT');
  const onTerm = forward('SIGTERM');
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  try {
    return await child.exited;
  } finally {
    process.off('SIGINT', onInt);
    process.off('SIGTERM', onTerm);
  }
};

/** `drizzle-kit <args>` (argv, no shell) against DATABASE_URL, or the built-in Postgres when it is empty. */
export async function runDrizzleKit(
  args: string[],
  env: Env = process.env,
  deps: { acquire?: typeof acquireLocalPg; spawn?: Spawn } = {},
): Promise<number> {
  const release = await (deps.acquire ?? acquireLocalPg)(env);
  try {
    return await (deps.spawn ?? spawnArgv)([process.execPath, 'x', 'drizzle-kit', ...args], env);
  } finally {
    await release();
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const error =
    testDbError(process.env) ?? (args[0] === 'drizzle-kit' ? null : sourceCliError(args));
  if (error) {
    console.error(`❌ ${error}`);
    process.exit(1);
  }
  if (args[0] === 'drizzle-kit') {
    const code = await runDrizzleKit(args.slice(1)).catch((e: Error) => {
      console.error(`❌ ${e.message}`);
      return 1;
    });
    process.exit(code);
  }
  // binary-entry reads argv[2] as the subcommand — same position as under the compiled binary.
  await import('../server/binary-entry');
}
