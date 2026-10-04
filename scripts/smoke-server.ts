/**
 * Boot a production server (script or compiled binary) on a free port, run the
 * black-box checks, print a table, exit non-zero on any failure.
 *
 *   bun scripts/smoke-server.ts ./st4s
 *   bun scripts/smoke-server.ts bun run server/prod.ts
 *   SMOKE_PORT=3090 bun scripts/smoke-server.ts ./st4s    (fixed port)
 *
 * Deliberately ignores PORT/NODE_ENV from the auto-loaded .env: the dev server
 * usually owns PORT, and a smoke run must exercise production mode.
 */
import { runChecks } from './smoke-server.checks';

const cmd = process.argv.slice(2);
if (cmd.length === 0) {
  console.error('Pemakaian: bun scripts/smoke-server.ts <perintah server…>');
  process.exit(2);
}
if (process.env.SMOKE_PORT && Number(process.env.SMOKE_PORT) === Number(process.env.PORT)) {
  console.error('SMOKE_PORT sama dengan PORT dev server — pilih port lain.');
  process.exit(2);
}
const port = Number(process.env.SMOKE_PORT ?? 3090 + Math.floor(Math.random() * 500));
const base = `http://localhost:${port}`;
const BOOT_TIMEOUT_MS = 30_000;

const child = Bun.spawn(cmd, {
  env: { ...process.env, PORT: String(port), NODE_ENV: process.env.SMOKE_NODE_ENV ?? 'production' },
  stdout: 'pipe',
  stderr: 'pipe',
});
const started = Date.now();
let up = false;
while (Date.now() - started < BOOT_TIMEOUT_MS) {
  try {
    const r = await fetch(`${base}/api/version`);
    if (r.ok) {
      up = true;
      break;
    }
  } catch {
    // not listening yet
  }
  if (child.exitCode !== null) break;
  await Bun.sleep(300);
}
const finish = async (code: number) => {
  child.kill();
  await child.exited;
  process.exit(code);
};
if (!up) {
  console.error(`Server tidak siap dalam ${BOOT_TIMEOUT_MS / 1000}s (exit ${child.exitCode}).`);
  console.error(await new Response(child.stderr).text());
  await finish(1);
}

const version = (await (await fetch(`${base}/api/version`)).json()) as Record<string, string>;
console.log(
  `\n${cmd.join(' ')}  →  ${base}  (${version.name} v${version.version}, env=${version.env}, bun ${version.bun})\n`,
);
const results = await runChecks(base);
for (const r of results) console.log(`${r.ok ? '✅' : '❌'} ${r.name.padEnd(42)} ${r.detail}`);
const failed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} pemeriksaan lulus${failed.length ? ` — ${failed.length} GAGAL` : ''}\n`,
);
if (version.env !== 'production')
  console.log(
    `⚠️  env=${version.env}: server tidak berjalan dalam mode production (NODE_ENV dari .env?).\n`,
  );
await finish(failed.length ? 1 : 0);
