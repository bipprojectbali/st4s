import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  APP_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().url(),
  DATABASE_URL_TEST: z.string().url().optional(),
  BETTER_AUTH_SECRET: z.string().min(1),
  BETTER_AUTH_URL: z.string().url().default('http://localhost:3000'),
  // Google OAuth (optional — social login is enabled only when both are set).
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // Comma-separated emails granted super-admin (env is the source of truth).
  SUPER_ADMIN_EMAILS: z.string().optional(),
  // 'true' closes email+password sign-up; unset → closed in production, open elsewhere.
  AUTH_DISABLE_SIGNUP: z.enum(['true', 'false']).optional(),
  // MCP debug server — if not set, /api/mcp returns 503.
  // Generate: openssl rand -hex 32
  MCP_ADMIN_TOKEN: z.string().min(32).optional(),
  // API rate limit per client IP (sliding window). Auth + MCP routes are excluded.
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('\u274c Invalid environment variables:');
  console.error(z.treeifyError(parsed.error));
  throw new Error('Invalid environment variables');
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const hasGoogleAuth = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

/** Whether email+password sign-up is closed: explicit AUTH_DISABLE_SIGNUP wins, else closed in production. */
export function resolveSignupDisabled(raw: 'true' | 'false' | undefined, nodeEnv: string): boolean {
  return raw === undefined ? nodeEnv === 'production' : raw === 'true';
}

export const signupDisabled = resolveSignupDisabled(env.AUTH_DISABLE_SIGNUP, env.NODE_ENV);

/** Normalized set of super-admin emails (lowercased, de-duped, blanks dropped). */
export const superAdminEmails: ReadonlySet<string> = new Set(
  (env.SUPER_ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);
