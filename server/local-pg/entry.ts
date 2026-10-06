/** `bun run dev|start` entry: start the built-in Postgres (empty DATABASE_URL) before server/env.ts is imported. */
import { bootLocalPg } from './boot';

const target = process.argv[2];
if (target !== 'dev' && target !== 'prod') {
  console.error('Pemakaian: bun server/local-pg/entry.ts dev|prod');
  process.exit(2);
}
await bootLocalPg().catch((e: Error) => {
  console.error(`[st4s] ${e.message}`);
  process.exit(1);
});
await (target === 'dev' ? import('../dev') : import('../prod'));
