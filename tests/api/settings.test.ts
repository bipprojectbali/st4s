import { afterEach, describe, expect, mock, test } from 'bun:test';

// Bypass auth — settings PUT requires super-admin; GET is public.
mock.module('../../server/guard', () => ({
  requireRole: async () => ({ user: { id: 'u-super' }, role: 'super-admin' }),
}));

import { eq } from 'drizzle-orm';
import Elysia from 'elysia';
import { settingsApi } from '../../server/api/settings';
import { db } from '../../server/db';
import { appSetting } from '../../server/db/schema';
import { rateLimiter } from '../../server/middleware/rate-limiter';

const app = new Elysia().use(settingsApi);

const SINGLETON = 'singleton';

async function get() {
  const res = await app.handle(new Request('http://localhost/settings'));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function put(body: Record<string, unknown>, path = '/settings') {
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

afterEach(async () => {
  await db
    .delete(appSetting)
    .where(eq(appSetting.id, SINGLETON))
    .catch(() => {});
  // Restore the process-wide limiter to env defaults for other test files.
  await app.handle(new Request('http://localhost/settings/rate-limit', { method: 'DELETE' }));
});

// ─── GET /settings ────────────────────────────────────────────────────────────

describe('GET /settings', () => {
  test('returns defaults when no row exists', async () => {
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.emailAuthEnabled).toBe(false);
    expect(body.signupEnabled).toBe(true);
    // Public endpoint must not leak admin-only configuration.
    expect(body.rateLimitMax).toBeUndefined();
  });

  test('returns persisted values after an upsert', async () => {
    await put({ emailAuthEnabled: true, signupEnabled: false });
    const { body } = await get();
    expect(body.emailAuthEnabled).toBe(true);
    expect(body.signupEnabled).toBe(false);
  });
});

// ─── PUT /settings ────────────────────────────────────────────────────────────

describe('PUT /settings', () => {
  test('creates the singleton row and returns updated values', async () => {
    const { status, body } = await put({ emailAuthEnabled: true, signupEnabled: true });
    expect(status).toBe(200);
    expect(body.emailAuthEnabled).toBe(true);
    expect(body.signupEnabled).toBe(true);
  });

  test('updates existing row (idempotent upsert)', async () => {
    await put({ emailAuthEnabled: true, signupEnabled: true });
    const { body } = await put({ emailAuthEnabled: false, signupEnabled: false });
    expect(body.emailAuthEnabled).toBe(false);
    expect(body.signupEnabled).toBe(false);
  });

  test('rejects request missing required fields', async () => {
    const { status } = await put({ emailAuthEnabled: true });
    expect(status).toBeGreaterThanOrEqual(400);
  });

  test('rejects non-boolean values', async () => {
    const { status } = await put({ emailAuthEnabled: 'yes', signupEnabled: 1 });
    expect(status).toBeGreaterThanOrEqual(400);
  });
});

// ─── Rate-limit settings ──────────────────────────────────────────────────────

async function getAll() {
  const res = await app.handle(new Request('http://localhost/settings/all'));
  return (await res.json()) as {
    settings: Record<string, unknown>;
    rateLimit: {
      defaults: { max: number; windowMs: number };
      effective: { limit: number; windowMs: number; enabled: boolean; excludePrefixes: string[] };
    };
    runtime: Record<string, unknown>;
  };
}

describe('GET /settings/all', () => {
  test('returns settings, defaults, effective config and runtime facts', async () => {
    const body = await getAll();
    expect(body.settings.rateLimitEnabled).toBe(true);
    expect(body.settings.rateLimitMax).toBeNull();
    expect(body.rateLimit.defaults.max).toBeGreaterThan(0);
    expect(body.rateLimit.effective.limit).toBe(body.rateLimit.defaults.max);
    expect(body.rateLimit.effective.excludePrefixes).toContain('/api/auth/');
    expect(typeof body.runtime.googleAuthConfigured).toBe('boolean');
  });
});

describe('PUT /settings/rate-limit', () => {
  test('stores overrides and applies them to the running limiter immediately', async () => {
    const { status, body } = await put(
      {
        rateLimitEnabled: true,
        rateLimitMax: 7,
        rateLimitWindowMs: 5_000,
        rateLimitExcludePrefixes: ['/api/auth/', '/api/health'],
      },
      '/settings/rate-limit',
    );
    expect(status).toBe(200);
    expect(body.rateLimitMax).toBe(7);
    expect(rateLimiter.config.limit).toBe(7);
    expect(rateLimiter.config.windowMs).toBe(5_000);
    expect(rateLimiter.config.excludePrefixes).toEqual(['/api/auth/', '/api/health']);
    const all = await getAll();
    expect(all.rateLimit.effective.limit).toBe(7);
    expect(all.settings.rateLimitExcludePrefixes).toEqual(['/api/auth/', '/api/health']);
  });

  test('null fields fall back to env defaults; disabling turns the limiter off', async () => {
    await put(
      {
        rateLimitEnabled: false,
        rateLimitMax: null,
        rateLimitWindowMs: null,
        rateLimitExcludePrefixes: null,
      },
      '/settings/rate-limit',
    );
    const all = await getAll();
    expect(all.rateLimit.effective.enabled).toBe(false);
    expect(all.rateLimit.effective.limit).toBe(all.rateLimit.defaults.max);
    expect(rateLimiter.config.enabled).toBe(false);
  });

  test('rejects out-of-range values and prefixes without a leading slash', async () => {
    expect(
      (await put({ rateLimitEnabled: true, rateLimitMax: 0 }, '/settings/rate-limit')).status,
    ).toBeGreaterThanOrEqual(400);
    expect(
      (await put({ rateLimitEnabled: true, rateLimitWindowMs: 10 }, '/settings/rate-limit')).status,
    ).toBeGreaterThanOrEqual(400);
    expect(
      (
        await put(
          { rateLimitEnabled: true, rateLimitExcludePrefixes: ['api/x'] },
          '/settings/rate-limit',
        )
      ).status,
    ).toBeGreaterThanOrEqual(400);
  });

  test('DELETE resets overrides to defaults and re-enables', async () => {
    await put({ rateLimitEnabled: false, rateLimitMax: 3 }, '/settings/rate-limit');
    const res = await app.handle(
      new Request('http://localhost/settings/rate-limit', { method: 'DELETE' }),
    );
    expect(res.status).toBe(200);
    const all = await getAll();
    expect(all.settings.rateLimitEnabled).toBe(true);
    expect(all.settings.rateLimitMax).toBeNull();
    expect(rateLimiter.config.enabled).toBe(true);
  });
});
