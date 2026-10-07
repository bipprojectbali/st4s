import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL?.trim();
// drizzle-kit loads this file in-process, so argv[2] is its command; these only read the schema.
const OFFLINE_COMMANDS = ['generate', 'check', 'export', 'up'];
if (!url && !OFFLINE_COMMANDS.includes(process.argv[2] ?? ''))
  throw new Error(
    'DATABASE_URL kosong — jalankan lewat `bun run db:push` / `bun run db:studio` (memakai PostgreSQL bawaan bila DATABASE_URL kosong), atau isi DATABASE_URL di .env.',
  );

export default defineConfig({
  dialect: 'postgresql',
  schema: [
    './server/db/schema.auth.ts',
    './server/db/schema.app.ts',
    './server/db/schema.logs.ts',
    './server/db/schema.keys.ts',
  ],
  out: './server/db/migrations',
  ...(url && { dbCredentials: { url } }),
  verbose: true,
  strict: true,
});
