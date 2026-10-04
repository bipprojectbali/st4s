import { Elysia } from 'elysia';
import { apiErrorPlugin, notFoundResponse } from '../api-error';
import { apiKeyPlugin } from '../api-keys/plugin';
import { startUsageRollupScheduler } from '../api-keys/rollup';
import { auth } from '../auth';
import { mcpPlugin } from '../mcp';
import { maintenancePlugin } from '../middleware/maintenance';
import { rateLimitPlugin } from '../middleware/rate-limiter';
import { applyRateLimitSettings } from '../settings';
import { startRetentionScheduler } from '../settings-retention';
import { v1Api } from '../v1';
import { adminApi } from './admin';
import { analyticsApi } from './analytics';
import { apiKeysApi } from './api-keys';
import { apiKeysUsageApi } from './api-keys-usage';
import { auditApi } from './audit';
import { enginesApi } from './engines';
import { fileHealthApi } from './file-health';
import { logsApi } from './logs';
import { meApi } from './me';
import { meApiKeysApi } from './me-api-keys';
import { opsApi } from './ops';
import { postsApi } from './posts';
import { sessionsApi } from './sessions';
import { settingsApi } from './settings';
import { settingsOpsApi } from './settings-ops';
import { versionApi } from './version';

/**
 * Resolve the current Better Auth session from request headers.
 * Returns null when unauthenticated.
 */
async function getSession(headers: Headers) {
  return auth.api.getSession({ headers });
}

// Load stored rate-limit overrides once per process (env defaults until then),
// and start the daily log-retention job.
void applyRateLimitSettings();
if (process.env.NODE_ENV !== 'test') {
  startRetentionScheduler();
  startUsageRollupScheduler();
}

const AUTH_BASE = '/api/auth';

/**
 * Main Elysia API. Everything here is served under `/api` (see mount in
 * server/app.ts). Better Auth owns `/api/auth/*`.
 */
export const api = new Elysia({ prefix: '/api' })
  // Uniform JSON errors (404/422/500 + request id) must be registered before any route.
  .use(apiErrorPlugin())
  // Rate limiting first: Elysia hooks only cover routes registered after them,
  // so this must precede every plugin (auth + mcp are excluded inside the plugin).
  .use(rateLimitPlugin())
  // Maintenance mode: 503 for everyone but the allowed roles (auth routes exempt).
  .use(maintenancePlugin())
  // API keys: identity + scope enforcement + usage tracking (X-API-Key / Bearer mk_live_…).
  .use(apiKeyPlugin())
  // Better Auth handler for /api/auth/*. A mount is a catch-all fallback for
  // every unmatched /api path, so anything else gets the uniform JSON 404 here
  // instead of Better Auth's empty one.
  .mount((request) =>
    new URL(request.url).pathname.startsWith(AUTH_BASE)
      ? auth.handler(request)
      : notFoundResponse(request),
  )
  // Admin console endpoints (self-guarded by role).
  .use(adminApi)
  // MCP debug server at /api/mcp — API key with `mcp` scope, or legacy MCP_ADMIN_TOKEN.
  .use(mcpPlugin)
  // Analytics read endpoints (super-admin only).
  .use(analyticsApi)
  // Audit trail of privileged actions (super-admin only).
  .use(auditApi)
  // API key usage log across keys (static /api-keys/usage before /api-keys/:id).
  .use(apiKeysUsageApi)
  // API key management (super-admin only).
  .use(apiKeysApi)
  // Cross-user session management (super-admin only).
  .use(sessionsApi)
  // File health report (super-admin only).
  .use(fileHealthApi)
  // Server log ring buffer (super-admin only).
  .use(logsApi)
  // App settings (GET public, PUT super-admin only).
  .use(settingsApi)
  .use(settingsOpsApi)
  // Operational tools (status, MCP catalog, cache resets) — super-admin only.
  .use(opsApi)
  // Speech engine status + warmup/unload (super-admin session only).
  .use(enginesApi)
  // Current-user endpoints (profile page) + personal API keys.
  .use(meApiKeysApi)
  .use(meApi)
  // Derive the session for downstream handlers.
  .derive(async ({ request }) => {
    const s = await getSession(request.headers);
    return { user: s?.user ?? null, session: s?.session ?? null };
  })
  // Build identity (name/version from package.json) — public, also for uptime probes.
  .use(versionApi)
  .get('/hello', () => ({
    message: 'Hello from Elysia + Bun \u26a1',
    time: new Date().toISOString(),
  }))
  .get('/me', ({ user }) => ({ user }))
  // Posts (public reads, session writes, admin moderation) live in posts.ts.
  .use(postsApi)
  // OpenAI-compatible speech API (/api/v1/audio/*, /api/v1/models).
  .use(v1Api);

export type Api = typeof api;
