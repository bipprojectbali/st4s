/**
 * Live counters for the /dev sidebar, one cheap aggregate per menu. Alert
 * badges (colored) flag things that need attention; info badges (gray) give a
 * sense of scale. Cached briefly because the layout loader runs on every
 * console navigation, and every source degrades to "no badge" on failure.
 */
import { sql } from 'drizzle-orm';
import { countRateLimitLastHour } from './api/analytics-ratelimits.stats.query';
import { errorsLastHour, warningsLastHour } from './api/logs';
import { keyStats } from './api-keys/query';
import { changelogOverview } from './changelog';
import { db } from './db';
import { auditLog, loginLog, post, session, user, visitLog } from './db/schema';
import { migrationStatus } from './db/schema-stats';
import { env } from './env';
import { getStt, getTts } from './engines/registry';
import type { EngineStatus } from './engines/types';
import { memoryGuardStatus, type MemoryGuardStatus } from './memory-guard/state';
import { scanFileHealth } from './file-health/file-health.scan';
import { settingsOverview } from './settings';

export type SidebarBadge = {
  value: number;
  color?: string;
  tooltip?: string;
  tone?: 'alert' | 'info';
};
export type SidebarBadges = Record<string, SidebarBadge>;

const CACHE_TTL_MS = 15_000;
const nf = new Intl.NumberFormat('id-ID');
const count = sql<number>`count(*)::int`;
const last24h = (col: unknown) =>
  sql<number>`count(*) filter (where ${col} >= now() - interval '24 hours')::int`;

const alert = (value: number, color: string, tooltip: string): SidebarBadge => ({
  value,
  color,
  tooltip,
  tone: 'alert',
});
const info = (value: number, tooltip: string): SidebarBadge => ({
  value,
  color: 'gray',
  tooltip,
  tone: 'info',
});

/** Run a source; on failure log nothing and fall back so navigation never breaks. */
async function safe<T>(fallback: T, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch {
    return fallback;
  }
}

/** Status of each registered engine; an unregistered or failing engine is skipped. */
function engineStatuses(): EngineStatus[] {
  return [getStt, getTts].flatMap((get) => {
    try {
      return [get().status()];
    } catch {
      return [];
    }
  });
}

const GUARD_RECENT_MS = 60 * 60 * 1000;

/**
 * Engines badge: alert when any engine is in error, or while the memory guard sheds requests /
 * unloaded an engine within the last hour; else the loaded count; none when unregistered.
 */
export function engineBadge(
  statuses: EngineStatus[],
  guard: MemoryGuardStatus = memoryGuardStatus(),
  now = Date.now(),
): SidebarBadge | null {
  if (!statuses.length) return null;
  const failed = statuses.filter((s) => s.state === 'error');
  if (failed.length)
    return alert(
      failed.length,
      'red',
      `Engine error: ${failed.map((s) => `${s.kind.toUpperCase()} — ${s.lastError ?? 'tanpa pesan'}`).join('; ')}`,
    );
  const last = guard.lastAction;
  const recent = last && now - Date.parse(last.at) < GUARD_RECENT_MS;
  if (guard.shedding || recent)
    return alert(
      1,
      'orange',
      [
        guard.shedding && `RAM menipis (sisa ${guard.freePct ?? '?'}%): permintaan audio baru ditolak sementara`,
        recent && last && `Memory guard melepas engine ${last.engine.toUpperCase()} pada ${new Date(last.at).toLocaleTimeString('id-ID')}`,
      ]
        .filter(Boolean)
        .join('; '),
    );
  const loaded = statuses.filter((s) => s.state === 'ready' || s.state === 'busy').length;
  return info(loaded, `${loaded}/${statuses.length} engine sudah memuat model`);
}

async function collect(): Promise<SidebarBadges> {
  const [
    users,
    sessions,
    posts,
    keys,
    visits,
    logins,
    audits,
    blocked,
    migrations,
    files,
    settings,
    changelog,
  ] = await Promise.all([
    safe({ total: 0, banned: 0 }, async () => {
      const [r] = await db
        .select({
          total: count,
          banned: sql<number>`count(*) filter (where ${user.banned} = true)::int`,
        })
        .from(user);
      return r ?? { total: 0, banned: 0 };
    }),
    safe({ active: 0, impersonated: 0 }, async () => {
      const [r] = await db
        .select({
          active: sql<number>`count(*) filter (where ${session.expiresAt} > now())::int`,
          impersonated: sql<number>`count(*) filter (where ${session.expiresAt} > now() and ${session.impersonatedBy} is not null)::int`,
        })
        .from(session);
      return r ?? { active: 0, impersonated: 0 };
    }),
    safe(0, async () => (await db.select({ n: last24h(post.createdAt) }).from(post))[0]?.n ?? 0),
    safe(null, () => keyStats()),
    safe(
      0,
      async () => (await db.select({ n: last24h(visitLog.createdAt) }).from(visitLog))[0]?.n ?? 0,
    ),
    safe(
      0,
      async () => (await db.select({ n: last24h(loginLog.createdAt) }).from(loginLog))[0]?.n ?? 0,
    ),
    safe(
      0,
      async () => (await db.select({ n: last24h(auditLog.createdAt) }).from(auditLog))[0]?.n ?? 0,
    ),
    safe(0, () => countRateLimitLastHour()),
    safe(null, () => migrationStatus()),
    safe(null, () => scanFileHealth().then((r) => (r.available ? r.summary : null))),
    safe(null, () => settingsOverview()),
    safe(null, () => changelogOverview()),
  ]);
  const errors = errorsLastHour();
  const warnings = warningsLastHour();
  const settingsIssues = settings
    ? [
        !settings.rateLimit.effective.enabled && 'rate limit nonaktif',
        settings.maintenance.enabled && 'mode maintenance aktif',
        !(
          settings.retention.visitDays ||
          settings.retention.loginDays ||
          settings.retention.rateLimitDays ||
          settings.retention.auditDays ||
          settings.retention.apiUsageDays
        ) && 'retensi log belum diatur',
        !settings.settings.emailAuthEnabled &&
          !settings.runtime.googleAuthConfigured &&
          'tidak ada cara masuk',
      ].filter((x): x is string => Boolean(x))
    : [];

  const badges: SidebarBadges = {
    '/dev/users':
      users.banned > 0
        ? alert(users.banned, 'orange', `${nf.format(users.banned)} user sedang diblokir`)
        : info(users.total, `${nf.format(users.total)} user terdaftar`),
    '/dev/sessions':
      sessions.impersonated > 0
        ? alert(
            sessions.impersonated,
            'orange',
            `${nf.format(sessions.impersonated)} sesi impersonasi sedang berjalan`,
          )
        : info(
            sessions.active,
            `${nf.format(sessions.active)} sesi aktif (perangkat yang sedang masuk)`,
          ),
    '/dev/posts': info(posts, `${nf.format(posts)} post baru dalam 24 jam`),
    '/dev/visits': info(visits, `${nf.format(visits)} kunjungan dalam 24 jam`),
    '/dev/login-logs': info(logins, `${nf.format(logins)} login dalam 24 jam`),
    '/dev/audit': info(audits, `${nf.format(audits)} aksi admin tercatat dalam 24 jam`),
    '/dev/rate-limit-logs': alert(
      blocked,
      'red',
      `${nf.format(blocked)} request diblokir dalam 1 jam terakhir`,
    ),
    '/dev/server-logs':
      errors > 0
        ? alert(errors, 'red', `${nf.format(errors)} error dalam 1 jam terakhir`)
        : alert(warnings, 'yellow', `${nf.format(warnings)} warning dalam 1 jam terakhir`),
    '/dev/settings': alert(
      settingsIssues.length,
      'orange',
      settingsIssues.length ? `Perlu perhatian: ${settingsIssues.join(', ')}` : '',
    ),
    '/dev/tools': alert(
      env.MCP_ADMIN_TOKEN ? 1 : 0,
      'orange',
      'Token MCP bersama (MCP_ADMIN_TOKEN) masih aktif — pindah ke API key ber-scope mcp lalu hapus env-nya',
    ),
  };
  if (keys)
    badges['/dev/api-keys'] =
      keys.expiringSoon > 0
        ? alert(
            keys.expiringSoon,
            'yellow',
            `${nf.format(keys.expiringSoon)} API key berakhir dalam ${keys.expiringSoonDays} hari`,
          )
        : info(
            keys.active,
            `${nf.format(keys.active)} API key aktif · ${nf.format(keys.usage24h)} request 24 jam`,
          );
  if (migrations)
    badges['/dev/db-schema'] = alert(
      migrations.pending,
      'red',
      `${nf.format(migrations.pending)} migrasi belum diterapkan (${migrations.applied}/${migrations.journal})`,
    );
  if (files)
    badges['/dev/file-health'] = alert(
      files.over,
      'yellow',
      `${nf.format(files.over)} file melewati limit baris${files.danger ? ` · ${nf.format(files.danger)} berbahaya untuk konteks agent` : ''}`,
    );
  if (changelog?.available)
    badges['/dev/changelog'] = !changelog.currentHasEntry
      ? alert(1, 'yellow', `Versi ${changelog.currentVersion} belum punya entry di CHANGELOG.md`)
      : info(
          changelog.unreleasedCount,
          `${nf.format(changelog.unreleasedCount)} perubahan belum dirilis`,
        );
  const engines = engineBadge(engineStatuses());
  if (engines) badges['/dev/engines'] = engines;
  return badges;
}

let cache: { at: number; value: Promise<SidebarBadges> } | null = null;

/** Badges keyed by route. Shared across requests for CACHE_TTL_MS; `fresh` bypasses the cache. */
export function devSidebarBadges(opts: { fresh?: boolean } = {}): Promise<SidebarBadges> {
  const now = Date.now();
  if (!opts.fresh && cache && now - cache.at < CACHE_TTL_MS) return cache.value;
  const value = collect().catch(() => ({}) as SidebarBadges);
  cache = { at: now, value };
  return value;
}
