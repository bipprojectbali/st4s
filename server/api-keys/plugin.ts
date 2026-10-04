/**
 * Elysia plugin: authenticate API-key requests, enforce scope + IP allow-list,
 * expose the identity to guards, and record usage after the response.
 * Register after the rate limiter and before route plugins.
 */
import { eq } from 'drizzle-orm';
import { Elysia } from 'elysia';
import { newRequestId } from '../api-error';
import { API_KEY_PREFIX, auth } from '../auth';
import { db } from '../db';
import { apikey, user } from '../db/schema';
import { logger } from '../logger';
import { normalizeIp, resolveClientIp } from '../middleware/client-ip';
import { resolveGeo } from '../middleware/visitor-geo';
import { resolveUserRole } from '../roles';
import { parseLines } from '../settings.core';
import { isV1Path, v1Code, v1Error } from '../v1/errors';
import { getApiKeyIdentity, setApiKeyIdentity } from './identity';
import { isPublicRead, requiredScope, roleAllowsScope, type Scope } from './scopes';
import { recordUsage } from './usage';

export function extractApiKey(headers: Headers): string | null {
  const direct = headers.get('x-api-key');
  if (direct?.startsWith(API_KEY_PREFIX)) return direct;
  const bearer = headers.get('authorization');
  if (bearer?.startsWith('Bearer ') && bearer.slice(7).startsWith(API_KEY_PREFIX))
    return bearer.slice(7);
  return null;
}

/** Exact IPs or prefixes ("10.0." / "2001:db8:") — enough for allow-lists without a CIDR library. */
export function ipAllowed(list: string[] | null, ip: string | null): boolean {
  if (!list || list.length === 0) return true;
  if (!ip) return false;
  return list.some((entry) =>
    entry.endsWith('.') || entry.endsWith(':') ? ip.startsWith(entry) : ip === entry,
  );
}

/** Log fields of a refusal; `keyId` (a row id, not secret) is set only once the key verified. */
type RefusalCtx = { requestId: string; path: string; keyId?: string };

type Refusal = { status: number; code: string; message: string };

const INVALID_KEY: Refusal = {
  status: 401,
  code: 'INVALID_API_KEY',
  message: 'API key tidak valid',
};

/**
 * Better Auth verify failures → public, OpenAI-aligned codes (lowercased under /api/v1).
 * Unlisted codes fall back to INVALID_KEY so a library code never reaches the client.
 */
const VERIFY_REFUSALS: Record<string, Refusal> = {
  KEY_NOT_FOUND: INVALID_KEY,
  INVALID_API_KEY: INVALID_KEY,
  KEY_EXPIRED: {
    status: 401,
    code: 'INVALID_API_KEY',
    message: 'API key kedaluwarsa. Buat API key baru.',
  },
  KEY_DISABLED: {
    status: 401,
    code: 'INVALID_API_KEY',
    message: 'API key dinonaktifkan. Minta admin mengaktifkannya atau buat API key baru.',
  },
  USAGE_EXCEEDED: {
    status: 429,
    code: 'INSUFFICIENT_QUOTA',
    message: 'Kuota pemakaian API key habis. Minta admin menambah kuota atau buat API key baru.',
  },
  RATE_LIMITED: {
    status: 429,
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'API key melampaui batas request. Tunggu sebentar lalu coba lagi.',
  },
};

/** Public refusal for a Better Auth verify error code (unknown → invalid key). */
function verifyRefusal(rawCode: unknown): Refusal {
  return (typeof rawCode === 'string' && VERIFY_REFUSALS[rawCode]) || INVALID_KEY;
}

/** Retry-After seconds from Better Auth's RATE_LIMITED `details.tryAgainIn` (ms), if present. */
function retryAfterSec(error: unknown): string | null {
  const ms = (error as { details?: { tryAgainIn?: unknown } } | null)?.details?.tryAgainIn;
  return typeof ms === 'number' && ms > 0 ? String(Math.ceil(ms / 1000)) : null;
}

/**
 * Rejection Response in the template shape, or OpenAI shape for /api/v1, plus one warn line.
 * Never logs the key: Better Auth's stored `start` is its first 6 chars, all inside the public
 * `mk_live_` prefix, so it identifies nothing; `keyId` does once the key verified.
 */
const denier =
  (ctx: RefusalCtx) =>
  (
    status: number,
    error: string,
    extra: Record<string, unknown> = {},
    internal: { rawCode?: string; retryAfter?: string | null } = {},
  ) => {
    const code = typeof extra.code === 'string' ? extra.code : 'ENDPOINT_NOT_ALLOWED';
    logger.warn(
      {
        ...ctx,
        code,
        status,
        ...(typeof extra.scope === 'string' ? { scope: extra.scope } : {}),
        // Why the key failed (Better Auth code or KEY_REVOKED/OWNER_MISSING); log-only, never sent.
        ...(internal.rawCode ? { rawCode: internal.rawCode } : {}),
      },
      'api key refused',
    );
    // Same requestId as the log line, carried the way api-error.ts does (header always; body field outside v1).
    const headers: Record<string, string> = {
      'x-request-id': ctx.requestId,
      ...(internal.retryAfter ? { 'retry-after': internal.retryAfter } : {}),
    };
    return isV1Path(ctx.path)
      ? v1Error(status, error, {
          code: v1Code(extra.code) ?? (status === 401 ? 'invalid_api_key' : null),
          headers,
        })
      : new Response(JSON.stringify({ error, ...extra, code, status, requestId: ctx.requestId }), {
          status,
          headers: {
            'content-type': 'application/json',
            'cache-control': 'no-store',
            ...headers,
          },
        });
  };

export function apiKeyPlugin() {
  return (
    new Elysia({ name: 'api-key-auth' })
      // onRequest, not beforeHandle: route `derive`s (admin/me/posts) resolve the
      // actor in the transform phase, which runs before beforeHandle. onRequest
      // fires first for every route of the parent app and can short-circuit.
      .onRequest(async ({ request }) => {
        const key = extractApiKey(request.headers);
        if (!key) return;
        const url = new URL(request.url);
        const ctx: RefusalCtx = {
          requestId: request.headers.get('x-request-id') ?? newRequestId(),
          path: url.pathname,
        };
        const deny = denier(ctx);
        const scope = requiredScope(request.method, url.pathname);
        const publicRead = isPublicRead(request.method, url.pathname);
        if (!scope && !publicRead)
          return deny(403, 'Endpoint ini tidak bisa diakses dengan API key');

        // Verify without `permissions`: the plugin reports a missing scope as
        // KEY_NOT_FOUND, so scope is checked here to give callers a precise 403.
        const verified = await auth.api.verifyApiKey({ body: { key } });
        if (!verified.valid || !verified.key) {
          const rawCode = String(verified.error?.code ?? 'INVALID_API_KEY');
          const r = verifyRefusal(rawCode);
          return deny(
            r.status,
            r.message,
            { code: r.code },
            { rawCode, retryAfter: r.status === 429 ? retryAfterSec(verified.error) : null },
          );
        }
        ctx.keyId = verified.key.id;
        const rawPerms: unknown = verified.key.permissions;
        const perms = (() => {
          try {
            const parsed =
              typeof rawPerms === 'string'
                ? (JSON.parse(rawPerms) as { scope?: string[] })
                : ((rawPerms ?? {}) as { scope?: string[] });
            return parsed.scope ?? [];
          } catch {
            return [];
          }
        })();
        if (scope && !perms.includes(scope))
          return deny(403, `API key tidak punya scope ${scope}`, { code: 'MISSING_SCOPE', scope });

        const [extra] = await db
          .select({ allowedIps: apikey.allowedIps, revokedAt: apikey.revokedAt })
          .from(apikey)
          .where(eq(apikey.id, verified.key.id))
          .limit(1);
        if (extra?.revokedAt)
          return deny(
            401,
            'API key sudah dicabut. Buat API key baru.',
            { code: INVALID_KEY.code },
            { rawCode: 'KEY_REVOKED' },
          );
        const ip = resolveClientIp(request.headers);
        if (!ipAllowed(parseLines(extra?.allowedIps ?? null), ip))
          return deny(403, 'IP tidak diizinkan untuk API key ini', { code: 'IP_NOT_ALLOWED' });

        const [owner] = await db
          .select({
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            banned: user.banned,
          })
          .from(user)
          .where(eq(user.id, verified.key.referenceId))
          .limit(1);
        if (!owner)
          return deny(
            401,
            'Pemilik API key tidak ditemukan. Buat API key baru.',
            { code: INVALID_KEY.code },
            { rawCode: 'OWNER_MISSING' },
          );
        if (owner.banned) return deny(403, 'Pemilik API key diblokir', { code: 'OWNER_BANNED' });
        const role = await resolveUserRole(owner);
        if (scope && !roleAllowsScope(role, scope as Scope))
          return deny(403, 'Role pemilik kunci tidak mengizinkan scope ini', {
            code: 'ROLE_TOO_LOW',
            scope,
          });

        setApiKeyIdentity(request, {
          keyId: verified.key.id,
          keyName: verified.key.name ?? null,
          scopes: perms,
          user: owner,
          role,
          startedAt: performance.now(),
        });
      })
      .onAfterResponse({ as: 'global' }, ({ request, set }) => {
        const identity = getApiKeyIdentity(request);
        if (!identity) return;
        const url = new URL(request.url);
        recordUsage({
          keyId: identity.keyId,
          method: request.method,
          path: url.pathname,
          status: Number(set.status ?? 200) || 200,
          ip: normalizeIp(resolveClientIp(request.headers)),
          country: resolveGeo(request.headers).country,
          userAgent: request.headers.get('user-agent'),
          durationMs: Math.round(performance.now() - identity.startedAt),
        });
      })
  );
}
