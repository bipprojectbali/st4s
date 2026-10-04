import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: [
    './server/db/schema.auth.ts',
    './server/db/schema.app.ts',
    './server/db/schema.logs.ts',
    './server/db/schema.keys.ts',
  ],
  out: './server/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://makuro:makuro@localhost:5432/makuro',
  },
  verbose: true,
  strict: true,
});
