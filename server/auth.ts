import { apiKey } from '@better-auth/api-key';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { admin, multiSession } from 'better-auth/plugins';
import { AUDIT_ACTIONS, audit } from './audit';
import { db } from './db';
import * as schema from './db/schema';
import { env, hasGoogleAuth, signupDisabled } from './env';
import { logger } from './logger';
import { RESOLVED_IP_HEADER } from './middleware/client-ip';
import { describeClient, loginMethodFromPath } from './middleware/request-meta';
import { normalizeIp } from './middleware/visitor';
import { ac, ROLES, roles } from './permissions';
import { emailAuthGate, socialSignUpAllowed } from './settings-auth';

/** Public part of every key, e.g. mk_live_abc… — also how the header getter recognises a key. */
export const API_KEY_PREFIX = 'mk_live_';
const DEFAULT_KEY_TTL_SEC = 90 * 86_400;
const MAX_KEY_TTL_DAYS = 365;

/** Error codes the login page shows via the Better Auth error `message`. */
export const AUTH_GATE_ERRORS = {
  SIGNUP_DISABLED: 'Pendaftaran akun baru ditutup. Hubungi administrator untuk dibuatkan akun.',
  EMAIL_AUTH_DISABLED:
    'Login dengan email dinonaktifkan. Gunakan tombol Google atau hubungi administrator.',
} as const;

/** Server-side enforcement of the login settings; the login form only mirrors it. */
const enforceEmailAuthGate = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== '/sign-up/email' && ctx.path !== '/sign-in/email') return;
  const gate = await emailAuthGate();
  if (ctx.path === '/sign-up/email' && !gate.signUp) {
    throw APIError.from('FORBIDDEN', {
      code: 'SIGNUP_DISABLED',
      message: AUTH_GATE_ERRORS.SIGNUP_DISABLED,
    });
  }
  if (ctx.path === '/sign-in/email' && !gate.signIn) {
    throw APIError.from('FORBIDDEN', {
      code: 'EMAIL_AUTH_DISABLED',
      message: AUTH_GATE_ERRORS.EMAIL_AUTH_DISABLED,
    });
  }
});

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      apikey: schema.apikey,
    },
  }),
  plugins: [
    admin({
      ac,
      roles,
      adminRoles: [ROLES.ADMIN, ROLES.SUPER_ADMIN],
      defaultRole: ROLES.USER,
      impersonationSessionDuration: 60 * 60,
    }),
    // Lets a browser stay signed in to several accounts at once and switch
    // between them. Cookie-based, so no extra DB tables/migration.
    multiSession({ maximumSessions: 5 }),
    // API keys: hashed at rest, per-key expiry/rate limit/permissions. Our own
    // middleware (server/api-keys/*) adds scopes, usage tracking and rotation.
    apiKey({
      apiKeyHeaders: ['x-api-key', 'authorization'],
      customAPIKeyGetter: (ctx) => {
        const header =
          ctx.request?.headers.get('x-api-key') ?? ctx.request?.headers.get('authorization');
        if (!header) return null;
        const raw = header.startsWith('Bearer ') ? header.slice(7) : header;
        return raw.startsWith(API_KEY_PREFIX) ? raw : null;
      },
      defaultPrefix: API_KEY_PREFIX,
      defaultKeyLength: 32,
      requireName: true,
      minimumNameLength: 2,
      maximumNameLength: 60,
      enableMetadata: true,
      // defaultExpiresIn is consumed in seconds by the plugin (getDate(..., 'sec')).
      keyExpiration: {
        defaultExpiresIn: DEFAULT_KEY_TTL_SEC,
        minExpiresIn: 1,
        maxExpiresIn: MAX_KEY_TTL_DAYS,
      },
      rateLimit: { enabled: true, timeWindow: 60_000, maxRequests: 600 },
      // Session for API keys is off: our middleware resolves the owner itself.
      enableSessionForAPIKeys: false,
    }),
  ],
  databaseHooks: {
    session: {
      create: {
        after: async (session, ctx) => {
          try {
            const headers = ctx?.request?.headers ?? ctx?.headers ?? null;
            const meta = describeClient(headers, session.userAgent ?? null);
            const method = loginMethodFromPath(ctx?.path);
            await db.insert(schema.loginLog).values({
              userId: session.userId,
              ip: normalizeIp(session.ipAddress ?? null),
              userAgent: session.userAgent ?? null,
              method,
              ...meta,
            });
            const impersonatedBy = (session as { impersonatedBy?: string | null }).impersonatedBy;
            if (method === 'impersonation' && impersonatedBy) {
              void audit({
                actor: { id: impersonatedBy },
                headers: headers ? new Headers(headers) : null,
                action: AUDIT_ACTIONS.USER_IMPERSONATE,
                targetType: 'user',
                targetId: session.userId,
                summary: 'Admin masuk sebagai user ini',
              });
            }
          } catch (err) {
            logger.warn({ err, userId: session.userId }, 'failed to write login_log');
          }
        },
      },
    },
  },
  hooks: { before: enforceEmailAuthGate },
  // Session IPs and the built-in sign-in rate limit must use the TRUSTED_PROXIES-aware IP, not raw X-Forwarded-For.
  advanced: { ipAddress: { ipAddressHeaders: [RESOLVED_IP_HEADER] } },
  emailAndPassword: {
    enabled: true,
    // Also enforced (with a 403 + message) by enforceEmailAuthGate; kept as a backstop.
    disableSignUp: signupDisabled,
  },
  user: {
    // Self-service account deletion from /profile. Credential accounts must
    // confirm with their password; the client asks for it before calling.
    deleteUser: { enabled: true },
    // Closed sign-up also blocks NEW users via Google (existing users still sign in/link).
    // A rejection makes the OAuth callback redirect to errorCallbackURL ?error=signup_disabled.
    validateUserInfo: async ({ user, source }) => {
      if (source.action !== 'create-user' || source.method !== 'oauth') return;
      if (await socialSignUpAllowed(String(user.email ?? ''))) return;
      logger.info(
        { provider: source.oauth?.providerId },
        'social sign-up rejected: sign-up closed',
      );
      return { error: 'signup_disabled', errorDescription: AUTH_GATE_ERRORS.SIGNUP_DISABLED };
    },
  },
  socialProviders: hasGoogleAuth
    ? {
        google: {
          clientId: env.GOOGLE_CLIENT_ID as string,
          clientSecret: env.GOOGLE_CLIENT_SECRET as string,
        },
      }
    : undefined,
});

export type Auth = typeof auth;
