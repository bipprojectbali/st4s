/**
 * Binary entrypoint (bun build --compile). `--st4s-engine-child stt|tts` is checked
 * first: the engine spawners re-exec this binary with it, and children inherit the
 * parent's env. Otherwise `<ST4S_HOME>/.env` is loaded (real env wins; the build
 * disables Bun's cwd `.env` autoload), then argv[2] picks a subcommand or the server.
 *
 * The server defaults NODE_ENV to production before any module initializes so pino
 * picks its sync multistream and the API hides internal error details; an explicit
 * other NODE_ENV is respected but flagged. In the compiled binary the server refuses
 * to start while migrations are pending (`st4s migrate` applies them). An empty
 * DATABASE_URL starts the built-in Postgres first (never in engine children).
 */
import { type CliCommand, HELP_TEXT, loadHomeEnv, resolveCommand } from './cli/dispatch';
import { engineChildKind } from './engines/child-argv';

/** Exit code for a subcommand, or null to start the server. */
async function runSubcommand(command: CliCommand, args: string[]): Promise<number | null> {
  switch (command) {
    case 'init':
      return (await import('./cli/init')).runInit();
    case 'doctor':
      return (await import('./cli/doctor')).runDoctor();
    case 'migrate':
      return (await import('./cli/migrate')).runMigrate();
    case 'models':
      return (await import('./cli/models')).runModels(args);
    case 'version':
      console.log((await import('./cli/version')).versionLine());
      return 0;
    case 'help':
      console.log(HELP_TEXT);
      return 0;
    case 'unknown':
      console.error(`Perintah tidak dikenal: ${args[0]}\n\n${HELP_TEXT}`);
      return 2;
    default:
      return null;
  }
}

const command = resolveCommand(process.argv);
if (command === 'engine-child') {
  if (engineChildKind(process.argv) === 'stt')
    (await import('./engines/stt/child')).runSttChild(process.argv[4]);
  else (await import('./engines/tts/child')).runTtsChild();
} else {
  const envFile = loadHomeEnv();
  const code = await runSubcommand(command, process.argv.slice(command === 'unknown' ? 2 : 3));
  if (code !== null) process.exit(code);
  process.env.NODE_ENV ??= 'production';
  if (process.env.NODE_ENV !== 'production') {
    console.warn(
      `[st4s] NODE_ENV=${process.env.NODE_ENV} — binary berjalan bukan dalam mode production (cek ${envFile ?? 'environment'}).`,
    );
  }
  // Before ./prod imports server/env.ts: an empty DATABASE_URL gets the built-in Postgres injected.
  await (await import('./local-pg/boot')).bootLocalPg().catch((e: Error) => {
    console.error(`[st4s] ${e.message}`);
    process.exit(1);
  });
  if (Bun.isStandaloneExecutable) {
    const error = await (await import('./cli/migrate')).bootMigrationError();
    if (error) {
      console.error(`[st4s] ${error}`);
      process.exit(1);
    }
  }
  await import('./prod');
}
