/**
 * Scope catalog for API keys. Every key stores its scopes in the plugin's
 * `permissions` column as { scope: [...] }; every API route maps to at most one
 * required scope. Routes without a scope (auth, key management, MCP for now)
 * are never reachable with a key.
 */
import { isAdminRole, normalizeRole, ROLES, type Role } from '../permissions';

export type Scope = (typeof SCOPES)[number]['id'];

export const SCOPES = [
  {
    id: 'analytics:read',
    label: 'Analytics (baca)',
    description: 'Visitor, login, rate-limit log + statistik dan export',
    minRole: ROLES.SUPER_ADMIN,
  },
  {
    id: 'analytics:write',
    label: 'Analytics (hapus)',
    description: 'Hapus / purge log analytics',
    minRole: ROLES.SUPER_ADMIN,
  },
  {
    id: 'users:read',
    label: 'Users (baca)',
    description: 'Direktori user dan statistik',
    minRole: ROLES.ADMIN,
  },
  {
    id: 'users:write',
    label: 'Users (ubah)',
    description: 'Role, ban, hapus user',
    minRole: ROLES.ADMIN,
  },
  {
    id: 'sessions:read',
    label: 'Sessions (baca)',
    description: 'Sesi aktif lintas user',
    minRole: ROLES.SUPER_ADMIN,
  },
  {
    id: 'sessions:write',
    label: 'Sessions (cabut)',
    description: 'Cabut sesi',
    minRole: ROLES.SUPER_ADMIN,
  },
  {
    id: 'posts:write',
    label: 'Posts (tulis)',
    description: 'Buat, ubah, hapus post (baca selalu publik)',
    minRole: ROLES.USER,
  },
  {
    id: 'audit:read',
    label: 'Audit log (baca)',
    description: 'Jejak aksi admin',
    minRole: ROLES.SUPER_ADMIN,
  },
  {
    id: 'logs:read',
    label: 'Server logs (baca)',
    description: 'Buffer log proses',
    minRole: ROLES.SUPER_ADMIN,
  },
  {
    id: 'file-health:read',
    label: 'File health (baca)',
    description: 'Ukuran file dan risiko konteks',
    minRole: ROLES.SUPER_ADMIN,
  },
  {
    id: 'settings:read',
    label: 'Settings (baca)',
    description: 'Semua pengaturan runtime',
    minRole: ROLES.SUPER_ADMIN,
  },
  {
    id: 'settings:write',
    label: 'Settings (ubah)',
    description: 'Ubah pengaturan runtime',
    minRole: ROLES.SUPER_ADMIN,
  },
  {
    id: 'ops:read',
    label: 'Ops (baca)',
    description: 'Status proses dan katalog MCP',
    minRole: ROLES.SUPER_ADMIN,
  },
  {
    id: 'mcp',
    label: 'MCP debug server',
    description: 'Semua tool agent: log, DB, status, file health',
    minRole: ROLES.SUPER_ADMIN,
  },
  {
    id: 'me:read',
    label: 'Profil sendiri (baca)',
    description: 'Data dan riwayat login akun pemilik kunci',
    minRole: ROLES.USER,
  },
  {
    id: 'stt:transcribe',
    label: 'Speech-to-text',
    description: 'Transkripsi audio lewat /api/v1/audio/transcriptions',
    minRole: ROLES.USER,
  },
  {
    id: 'tts:speak',
    label: 'Text-to-speech',
    description: 'Sintesis suara lewat /api/v1/audio/speech',
    minRole: ROLES.USER,
  },
] as const;

export const SCOPE_IDS = SCOPES.map((s) => s.id) as readonly string[];

export function isScope(v: string): v is Scope {
  return SCOPE_IDS.includes(v);
}

const ROLE_RANK: Record<Role, number> = { user: 0, admin: 1, 'super-admin': 2 };

/** A key can never grant more than its owner's role allows. */
export function roleAllowsScope(role: unknown, scope: Scope): boolean {
  const def = SCOPES.find((s) => s.id === scope);
  if (!def) return false;
  return ROLE_RANK[normalizeRole(role)] >= ROLE_RANK[def.minRole];
}

export function scopesForRole(role: unknown): Scope[] {
  return SCOPES.filter((s) => roleAllowsScope(role, s.id)).map((s) => s.id);
}

const READ = new Set(['GET', 'HEAD']);

/**
 * Required scope for an API route, or null when API keys may not call it.
 * Order matters: more specific prefixes first.
 */
export function requiredScope(method: string, pathname: string): Scope | null {
  const m = method.toUpperCase();
  const read = READ.has(m);
  const p = pathname;
  if (
    p.startsWith('/api/auth/') ||
    p.startsWith('/api/api-keys') ||
    p.startsWith('/api/me/api-keys')
  )
    return null;
  // MCP is a JSON-RPC endpoint: every method needs the mcp scope.
  if (p.startsWith('/api/mcp')) return 'mcp';
  if (p === '/api/settings' || p === '/api/settings/')
    return read ? 'settings:read' : 'settings:write';
  if (p.startsWith('/api/settings')) return read ? 'settings:read' : 'settings:write';
  if (p.startsWith('/api/analytics/purge')) return 'analytics:write';
  if (p.startsWith('/api/analytics')) return read ? 'analytics:read' : 'analytics:write';
  if (p.startsWith('/api/admin/users')) return read ? 'users:read' : 'users:write';
  if (p.startsWith('/api/sessions')) return read ? 'sessions:read' : 'sessions:write';
  if (p.startsWith('/api/audit')) return read ? 'audit:read' : null;
  if (p.startsWith('/api/logs')) return read ? 'logs:read' : null;
  if (p.startsWith('/api/file-health')) return read ? 'file-health:read' : null;
  if (p.startsWith('/api/ops/reset')) return null;
  // Engine control loads/frees models: super-admin browser session only.
  if (p.startsWith('/api/engines')) return null;
  if (p.startsWith('/api/ops')) return read ? 'ops:read' : null;
  if (p.startsWith('/api/me')) return read ? 'me:read' : null;
  if (p.startsWith('/api/posts')) return read ? null : 'posts:write';
  if (p === '/api/v1/audio/transcriptions' || p === '/api/v1/audio/translations')
    return read ? null : 'stt:transcribe';
  if (p === '/api/v1/audio/speech') return read ? null : 'tts:speak';
  return null;
}

/** Public reads (e.g. GET /api/posts, /api/hello, /api/version) need no scope but may still carry a key for tracking. */
export function isPublicRead(method: string, pathname: string): boolean {
  return (
    READ.has(method.toUpperCase()) &&
    (pathname.startsWith('/api/posts') ||
      pathname === '/api/hello' ||
      pathname === '/api/version' ||
      pathname === '/api/v1/models' ||
      pathname.startsWith('/api/v1/models/') ||
      pathname === '/api/v1/audio/voices')
  );
}

export function isAdminScope(scope: Scope): boolean {
  const def = SCOPES.find((s) => s.id === scope);
  return def ? isAdminRole(def.minRole) : false;
}
