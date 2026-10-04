/**
 * Maintenance mode: when enabled, everyone except the allowed roles gets a 503
 * (HTML for pages, JSON for /api). Sign-in stays open so admins can get in.
 */
import { auth } from './auth';
import { normalizeRole, ROLES, type Role } from './permissions';
import { resolveUserRole } from './roles';
import {
  joinLines,
  parseLines,
  readSettingsRow,
  type SettingsRow,
  upsertSettingsRow,
} from './settings.core';

export type MaintenanceSettings = {
  enabled: boolean;
  message: string | null;
  allowRoles: Role[] | null;
};
export const MAINTENANCE_DEFAULTS = {
  message: 'Kami sedang melakukan pemeliharaan singkat. Silakan coba lagi beberapa saat lagi.',
  allowRoles: [ROLES.SUPER_ADMIN] as Role[],
  retryAfterSeconds: 300,
};

/** Paths that must keep working during maintenance (login, auth API, public settings, assets). */
const EXEMPT_PREFIXES = [
  '/login',
  '/go',
  '/api/auth/',
  '/api/settings',
  '/assets/',
  '/favicon',
  '/_vite/',
  '/@',
  '/node_modules/',
  '/.well-known/',
  '/README.md',
  '/readme.md',
  '/llms',
  '/skill.md',
  '/robots.txt',
  '/sitemap.xml',
  '/site.webmanifest',
  '/og.png',
  '/apple-touch-icon',
];

export function parseMaintenance(row: SettingsRow | null): MaintenanceSettings {
  const roles = parseLines(row?.maintenanceAllowRoles)?.map((r) => normalizeRole(r)) ?? null;
  return {
    enabled: Boolean(row?.maintenanceEnabled),
    message: row?.maintenanceMessage ?? null,
    allowRoles: roles,
  };
}

export async function getMaintenance(): Promise<MaintenanceSettings> {
  return parseMaintenance(await readSettingsRow());
}

export async function upsertMaintenance(s: MaintenanceSettings): Promise<MaintenanceSettings> {
  await upsertSettingsRow({
    maintenanceEnabled: s.enabled,
    maintenanceMessage: s.message?.trim() || null,
    maintenanceAllowRoles: joinLines(s.allowRoles),
  });
  return parseMaintenance(await readSettingsRow());
}

export function isMaintenanceExempt(pathname: string): boolean {
  return EXEMPT_PREFIXES.some((p) => pathname.startsWith(p)) || pathname.endsWith('.data');
}

/** Pure decision: should this request be blocked? */
export function shouldBlock(s: MaintenanceSettings, pathname: string, role: Role | null): boolean {
  if (!s.enabled || isMaintenanceExempt(pathname)) return false;
  const allowed = s.allowRoles ?? MAINTENANCE_DEFAULTS.allowRoles;
  return !(role && allowed.includes(role));
}

function html(message: string, appName: string): string {
  const esc = (v: string) =>
    v.replace(
      /[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c,
    );
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(appName)} — Pemeliharaan</title><meta name="robots" content="noindex"><style>body{margin:0;font-family:system-ui,sans-serif;background:#111;color:#eee;display:grid;place-items:center;min-height:100vh;padding:24px}main{max-width:480px;text-align:center}h1{font-size:1.5rem;margin:0 0 12px}p{color:#bbb;line-height:1.5}a{color:#8ab4ff}</style></head><body><main><h1>${esc(appName)} sedang dalam pemeliharaan</h1><p>${esc(message)}</p><p><a href="/login">Masuk sebagai admin</a></p></main></body></html>`;
}

/**
 * Returns a 503 Response when the request must be blocked, else null. Only
 * resolves the session when maintenance is actually on, so the happy path
 * costs one cached settings read.
 */
export async function maintenanceGate(
  request: Request,
  appName = 'Makuro',
): Promise<Response | null> {
  const s = await getMaintenance();
  const pathname = new URL(request.url).pathname;
  if (!s.enabled || isMaintenanceExempt(pathname)) return null;
  let role: Role | null = null;
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    role = session?.user ? await resolveUserRole(session.user) : null;
  } catch {
    role = null;
  }
  if (!shouldBlock(s, pathname, role)) return null;
  const message = s.message?.trim() || MAINTENANCE_DEFAULTS.message;
  const headers = {
    'retry-after': String(MAINTENANCE_DEFAULTS.retryAfterSeconds),
    'cache-control': 'no-store',
  };
  if (pathname.startsWith('/api')) {
    return new Response(JSON.stringify({ error: 'maintenance', message }), {
      status: 503,
      headers: { ...headers, 'content-type': 'application/json' },
    });
  }
  return new Response(html(message, appName), {
    status: 503,
    headers: { ...headers, 'content-type': 'text/html; charset=utf-8' },
  });
}
