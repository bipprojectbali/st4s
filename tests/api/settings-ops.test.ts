import { afterAll, describe, expect, mock, test } from 'bun:test';
import Elysia from 'elysia';

mock.module('../../server/guard', () => ({
  requireRole: async () => ({
    user: { id: 'u-test', email: 'u-test@test.local' },
    role: 'super-admin',
  }),
}));

import { eq } from 'drizzle-orm';
import { settingsApi } from '../../server/api/settings';
import { settingsOpsApi } from '../../server/api/settings-ops';
import { db } from '../../server/db';
import { appSetting } from '../../server/db/schema';
import { maintenancePlugin } from '../../server/middleware/maintenance';
import { invalidateSettingsCache } from '../../server/settings.core';
import { upsertMaintenance } from '../../server/settings-maintenance';

const app = new Elysia().use(settingsApi).use(settingsOpsApi);
const json = (method: string, body: unknown) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
async function call(path: string, init?: RequestInit) {
  const res = await app.handle(new Request(`http://localhost${path}`, init));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

afterAll(async () => {
  await db
    .delete(appSetting)
    .where(eq(appSetting.id, 'singleton'))
    .catch(() => {});
  invalidateSettingsCache();
});

describe('settings ops API', () => {
  test('retention: PUT validates range, run returns a result', async () => {
    expect(
      (
        await call(
          '/settings/retention',
          json('PUT', {
            visitDays: 0,
            loginDays: null,
            rateLimitDays: null,
            auditDays: null,
            apiUsageDays: null,
          }),
        )
      ).status,
    ).toBeGreaterThanOrEqual(400);
    const { status, body } = await call(
      '/settings/retention',
      json('PUT', {
        visitDays: 30,
        loginDays: null,
        rateLimitDays: 7,
        auditDays: null,
        apiUsageDays: null,
      }),
    );
    expect(status).toBe(200);
    expect(body.visitDays).toBe(30);
    const run = await call('/settings/retention/run', json('POST', {}));
    expect(run.status).toBe(200);
    expect((run.body as { trigger: string }).trigger).toBe('manual');
    await call(
      '/settings/retention',
      json('PUT', {
        visitDays: null,
        loginDays: null,
        rateLimitDays: null,
        auditDays: null,
        apiUsageDays: null,
      }),
    );
  });

  test('maintenance: PUT persists and /settings/all reflects it', async () => {
    const { status, body } = await call(
      '/settings/maintenance',
      json('PUT', { enabled: true, message: 'Sebentar', allowRoles: ['super-admin', 'admin'] }),
    );
    expect(status).toBe(200);
    expect(body.enabled).toBe(true);
    const all = await call('/settings/all');
    expect((all.body.maintenance as { enabled: boolean }).enabled).toBe(true);
    await call(
      '/settings/maintenance',
      json('PUT', { enabled: false, message: null, allowRoles: null }),
    );
  });

  test('features: invalid key → 400, valid list saved and exposed publicly', async () => {
    expect(
      (
        await call(
          '/settings/features',
          json('PUT', { flags: [{ key: 'Bad Key', enabled: true, description: '' }] }),
        )
      ).status,
      // Schema pattern rejects it (422) before the handler's own 400 path.
    ).toBeGreaterThanOrEqual(400);
    const ok = await call(
      '/settings/features',
      json('PUT', { flags: [{ key: 'beta-x', enabled: true, description: 'test' }] }),
    );
    expect(ok.status).toBe(200);
    const pub = await call('/settings');
    expect((pub.body.features as Record<string, boolean>)['beta-x']).toBe(true);
    expect((pub.body.branding as { appName: string }).appName).toBeDefined();
  });

  test('branding: PUT trims and empties fall back to defaults', async () => {
    const { status, body } = await call(
      '/settings/branding',
      json('PUT', { appName: ' Acme ', appTagline: '', supportUrl: null }),
    );
    expect(status).toBe(200);
    expect(body.appName).toBe('Acme');
    expect(body.appTagline).toBeNull();
    const all = await call('/settings/all');
    expect(
      (all.body.branding as { effective: { appName: string; appTagline: string } }).effective,
    ).toMatchObject({
      appName: 'Acme',
      appTagline: 'speech-to-text & text-to-speech server kompatibel OpenAI',
    });
    await call(
      '/settings/branding',
      json('PUT', { appName: null, appTagline: null, supportUrl: null }),
    );
  });
});

describe('maintenancePlugin', () => {
  test('blocks anonymous API calls with 503 JSON when enabled, exempts auth routes, passes when disabled', async () => {
    const guarded = new Elysia()
      .use(maintenancePlugin())
      .get('/api/hello', () => 'ok')
      .get('/api/auth/session', () => 'ok');
    await upsertMaintenance({ enabled: true, message: 'Tutup', allowRoles: null });
    const blocked = await guarded.handle(new Request('http://localhost/api/hello'));
    expect(blocked.status).toBe(503);
    expect(blocked.headers.get('retry-after')).toBe('300');
    expect(((await blocked.json()) as { error: string }).error).toBe('maintenance');
    expect((await guarded.handle(new Request('http://localhost/api/auth/session'))).status).toBe(
      200,
    );
    await upsertMaintenance({ enabled: false, message: null, allowRoles: null });
    expect((await guarded.handle(new Request('http://localhost/api/hello'))).status).toBe(200);
  });
});
