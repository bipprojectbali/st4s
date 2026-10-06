import { expect, test } from 'bun:test';
import path from 'node:path';

const DB_MODULE = path.join(import.meta.dir, '../../server/db/index.ts');

// Runs in a subprocess because NODE_ENV is fixed per process; postgres-js is lazy and
// no query is issued, so the dummy URL is never connected to.
test('production shares the postgres client via globalThis', async () => {
  const proc = Bun.spawn(
    [
      'bun',
      '-e',
      `await import(${JSON.stringify(DB_MODULE)});
       process.stdout.write(String(typeof globalThis.__st4sDbClient === 'function'));
       process.exit(0);`,
    ],
    {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://user:pass@127.0.0.1:1/none', // test-only
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  expect(code, err).toBe(0);
  expect(out).toBe('true');
});
