import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../env';
import * as schema from './schema';
import { assertTestDatabase, isTestProcess } from './test-guard';

// Tests reach only the *_test DB the bun test preload put in DATABASE_URL; any other path fails here.
if (isTestProcess(process.env)) assertTestDatabase(process.env);

// Process-wide pool: the SSR bundle (build/server/index.js) is a second copy of this module, and dev hot reloads re-evaluate it.
const g = globalThis as typeof globalThis & { __st4sDbClient?: ReturnType<typeof postgres> };
g.__st4sDbClient ??= postgres(env.DATABASE_URL, { max: 5 });
const client = g.__st4sDbClient;

export const db = drizzle(client, { schema });
export { schema };
