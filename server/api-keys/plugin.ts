/**
 * Elysia plugin: authenticate API-key requests, enforce scope + IP allow-list,
 * expose the identity to guards, and record usage after the response.
 * Register after the rate limiter and before route plugins.
 */
import { eq } from 'drizzle-orm';
import { Elysia } from 'elysia';
import { API_KEY_PREFIX, auth } from '../auth';
import { db } from '../db';
import { apikey, user } from '../db/schema';
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

/** Rejection Response in the template shape, or OpenAI shape for /api/v1. */
const denier =
  (pathname: string) =>
  (status: number, error: string, extra: Record<string, unknown> = {}) =>
    isV1Path(pathname)
      ? v1Error(status, error, {
          code: v1Code(extra.code) ?? (status === 401 ? 'invalid_api_key' : null),
        })
      : new Response(JSON.stringify({ error, ...extra }), {
          status,
          headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
        });

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
        const deny = denier(url.pathname);
        const scope = requiredScope(request.method, url.pathname);
        const publicRead = isPublicRead(request.method, url.pathname);
        if (!scope && !publicRead)
          return deny(403, 'Endpoint ini tidak bisa diakses dengan API key');

        // Verify without `permissions`: the plugin reports a missing scope as
        // KEY_NOT_FOUND, so scope is checked here to give callers a precise 403.
        const verified = await auth.api.verifyApiKey({ body: { key } });
        if (!verified.valid || !verified.key) {
          const code = verified.error?.code ?? 'INVALID_API_KEY';
          if (code === 'RATE_LIMITED')
            return deny(429, 'API key melampaui batas request', { code });
          if (code === 'KEY_EXPIRED') return deny(401, 'API key kedaluwarsa', { code });
          if (code === 'KEY_DISABLED') return deny(401, 'API key dinonaktifkan', { code });
          return deny(401, 'API key tidak valid', { code });
        }
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
        if (extra?.revokedAt) return deny(401, 'API key sudah dicabut', { code: 'KEY_REVOKED' });
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
        if (!owner) return deny(401, 'Pemilik API key tidak ditemukan', { code: 'OWNER_MISSING' });
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
