/**
 * Sliding-window in-memory rate limiter + Elysia plugin.
 *
 * Limits are per client IP (see client-ip.ts). State lives in this process:
 * it resets on restart and is not shared between instances — use Redis for a
 * multi-instance deployment.
 *
 * Every API response carries X-RateLimit-Limit / X-RateLimit-Remaining; a
 * blocked request gets 429 + Retry-After and is recorded in `rate_limit_log`
 * with the same client enrichment as visit/login logs.
 *
 * The plugin must be registered BEFORE other plugins on the API instance —
 * Elysia hooks only cover routes registered after them (verified: a hook
 * added after `.use(plugin)` never runs for that plugin's routes).
 */
import { Elysia } from 'elysia';
import { db } from '../db';
import { rateLimitLog } from '../db/schema';
import { logger } from '../logger';
import {
  DEFAULT_EXCLUDE_PREFIXES,
  type RateLimitConfig,
  RateLimiter,
  type RateLimitResult,
  rateLimiter,
} from '../rate-limit';
import { isV1Path, v1ErrorBody } from '../v1/errors';
import { resolveClientIp } from './client-ip';
import { describeClient } from './request-meta';

// Re-exported so existing imports (settings, tests) keep working.
export {
  DEFAULT_EXCLUDE_PREFIXES,
  type RateLimitConfig,
  RateLimiter,
  type RateLimitResult,
  rateLimiter,
};

/** Persist a blocked request. Failures are logged, never thrown — must not cascade. */
export async function logRateLimit(input: {
  ip: string | null;
  path: string;
  method: string;
  userId: string | null;
  headers: Headers;
}): Promise<void> {
  try {
    const meta = describeClient(input.headers);
    await db.insert(rateLimitLog).values({
      ip: input.ip,
      path: input.path,
      method: input.method,
      userId: input.userId,
      userAgent: input.headers.get('user-agent')?.slice(0, 512) ?? null,
      ...meta,
    });
  } catch (err) {
    logger.warn({ err, path: input.path }, 'failed to write rate_limit_log');
  }
}

/**
 * Elysia plugin: applies the limiter to every route of the instance it is
 * used on (and its later plugins). Register it first.
 */
export function rateLimitPlugin(limiter: RateLimiter = rateLimiter) {
  return new Elysia({ name: 'rate-limit' }).onBeforeHandle({ as: 'global' }, ({ request, set }) => {
    if (!limiter.config.enabled) return;
    const pathname = new URL(request.url).pathname;
    if (limiter.isExcluded(pathname)) return;

    const ip = resolveClientIp(request.headers);
    const r = limiter.check(ip);
    set.headers['x-ratelimit-limit'] = String(r.limit);
    set.headers['x-ratelimit-remaining'] = String(r.remaining);
    if (!r.limited) return;

    const retryAfterSec = Math.max(1, Math.ceil(r.retryAfterMs / 1000));
    set.headers['retry-after'] = String(retryAfterSec);
    set.status = 429;
    void logRateLimit({
      ip,
      path: pathname,
      method: request.method,
      userId: null,
      headers: request.headers,
    });
    if (isV1Path(pathname))
      return v1ErrorBody(429, `Too many requests. Retry in ${retryAfterSec}s.`, 'rate_limit_exceeded');
    return { error: 'Too many requests', retryAfterSeconds: retryAfterSec };
  });
}
