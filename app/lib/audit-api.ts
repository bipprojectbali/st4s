/** Client for /api/audit (read-only audit trail). */
import type { Breakdown } from './visits-api';

export type AuditRow = {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  actorName: string | null;
  actorImage: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  summary: string;
  meta: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
};

export type AuditStats = {
  total: number;
  last24h: number;
  last7d: number;
  destructive: number;
  topActions: Breakdown[];
  topActors: Array<{
    actorId: string | null;
    email: string | null;
    name: string | null;
    image: string | null;
    count: number;
  }>;
  targets: Breakdown[];
};

export type AuditFilters = {
  search: string;
  action: string | null;
  targetType: string | null;
  actorId: string | null;
  period: '1' | '7' | '30' | 'all';
};
export const DEFAULT_AUDIT_FILTERS: AuditFilters = {
  search: '',
  action: null,
  targetType: null,
  actorId: null,
  period: 'all',
};
export type AuditListParams = AuditFilters & { page: number; limit: number };
export type AuditListResponse = { rows: AuditRow[]; total: number; page: number; limit: number };

const BASE = '/api/audit';

export function buildAuditQuery(p: Partial<AuditListParams>): URLSearchParams {
  const q = new URLSearchParams();
  if (p.page) q.set('page', String(p.page));
  if (p.limit) q.set('limit', String(p.limit));
  if (p.search?.trim()) q.set('search', p.search.trim());
  if (p.action) q.set('action', p.action);
  if (p.targetType) q.set('targetType', p.targetType);
  if (p.actorId) q.set('actorId', p.actorId);
  if (p.period && p.period !== 'all') q.set('days', p.period);
  return q;
}

export function hasActiveAuditFilters(f: AuditFilters): boolean {
  return (
    f.search.trim() !== '' ||
    f.action !== null ||
    f.targetType !== null ||
    f.actorId !== null ||
    f.period !== 'all'
  );
}

async function request<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Gagal memuat audit log (${res.status})`);
  return res.json();
}
export const fetchAudit = (p: AuditListParams) =>
  request<AuditListResponse>(`${BASE}?${buildAuditQuery(p)}`);
export const fetchAuditStats = () => request<AuditStats>(`${BASE}/stats`);
export const exportAuditUrl = (f: AuditFilters) => `${BASE}/export?${buildAuditQuery(f)}`;

const ACTION_META: Record<string, { label: string; color: string }> = {
  'user.role.set': { label: 'Ubah role', color: 'blue' },
  'user.ban': { label: 'Ban user', color: 'orange' },
  'user.unban': { label: 'Buka ban', color: 'teal' },
  'user.delete': { label: 'Hapus user', color: 'red' },
  'user.impersonate': { label: 'Impersonasi', color: 'grape' },
  'session.revoke': { label: 'Cabut sesi', color: 'orange' },
  'settings.auth.update': { label: 'Settings auth', color: 'indigo' },
  'settings.rate_limit.update': { label: 'Settings rate limit', color: 'indigo' },
  'settings.rate_limit.reset': { label: 'Reset rate limit', color: 'indigo' },
  'logs.purge': { label: 'Purge log', color: 'red' },
  'logs.delete': { label: 'Hapus log', color: 'red' },
  'logs.retention': { label: 'Retensi otomatis', color: 'gray' },
  'settings.retention.update': { label: 'Settings retensi', color: 'indigo' },
  'settings.maintenance.update': { label: 'Settings maintenance', color: 'orange' },
  'settings.features.update': { label: 'Feature flags', color: 'indigo' },
  'settings.branding.update': { label: 'Branding', color: 'indigo' },
  'ops.reset': { label: 'Reset cache', color: 'gray' },
  'post.update': { label: 'Edit post', color: 'blue' },
  'post.delete': { label: 'Hapus post', color: 'red' },
  'apikey.create': { label: 'Buat API key', color: 'indigo' },
  'apikey.update': { label: 'Ubah API key', color: 'blue' },
  'apikey.rotate': { label: 'Rotasi API key', color: 'yellow' },
  'apikey.revoke': { label: 'Cabut API key', color: 'red' },
  'apikey.delete': { label: 'Hapus API key', color: 'red' },
  'engine.warmup': { label: 'Warmup engine', color: 'teal' },
  'engine.unload': { label: 'Unload engine', color: 'orange' },
};

export function actionMeta(action: string): { label: string; color: string } {
  return ACTION_META[action] ?? { label: action, color: 'gray' };
}

export const TARGET_LABELS: Record<string, string> = {
  user: 'User',
  session: 'Sesi',
  settings: 'Settings',
  logs: 'Log',
  engine: 'Engine',
};
