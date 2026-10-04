import { frameInfo } from '@server/app-info';
import { requireRole } from '@server/guard';
import { ROLES } from '@server/permissions';
import { getSidebarCollapsed } from '@server/sidebar';
import { devSidebarBadges } from '@server/sidebar-badges';
import {
  FiClipboard,
  FiCpu,
  FiDatabase,
  FiEdit3,
  FiFileText,
  FiGrid,
  FiHome,
  FiKey,
  FiList,
  FiLogIn,
  FiMic,
  FiMonitor,
  FiSettings,
  FiShield,
  FiTag,
  FiTerminal,
  FiTool,
  FiUser,
  FiUsers,
} from 'react-icons/fi';
import { Outlet } from 'react-router';
import { AppFrame, type NavGroup, type NavItem } from '~/components/AppFrame';
import { AreaErrorBoundary } from '~/components/errors/AreaErrorBoundary';
import type { AppContext } from '~/lib/app-context';
import type { Route } from './+types/layout';

export function meta(_: Route.MetaArgs) {
  return [{ title: 'Dev Console — st4s' }];
}

const NAV: NavGroup[] = [
  {
    items: [
      { to: '/dev', label: 'Overview', icon: FiGrid, description: 'Ringkasan kondisi aplikasi' },
    ],
  },
  {
    label: 'Kelola',
    items: [
      {
        to: '/dev/users',
        label: 'Users',
        icon: FiUsers,
        description: 'Daftar user, role, ban, impersonasi',
      },
      {
        to: '/dev/sessions',
        label: 'Sessions',
        icon: FiMonitor,
        description: 'Perangkat yang sedang masuk, cabut sesi',
      },
      {
        to: '/dev/posts',
        label: 'Posts',
        icon: FiEdit3,
        description: 'Konten contoh: buat, edit, moderasi',
      },
      {
        to: '/dev/api-keys',
        label: 'API Keys',
        icon: FiKey,
        description: 'Kunci akses API: scope, rotasi, pemakaian',
      },
      {
        to: '/dev/db-schema',
        label: 'DB Schema',
        icon: FiDatabase,
        description: 'Diagram tabel dan relasi',
      },
    ],
  },
  {
    label: 'Log & monitoring',
    items: [
      {
        to: '/dev/visits',
        label: 'Visitor Logs',
        icon: FiList,
        description: 'Kunjungan halaman, lokasi, perangkat',
      },
      {
        to: '/dev/login-logs',
        label: 'Login Logs',
        icon: FiLogIn,
        description: 'Siapa masuk, lewat apa, dari mana',
      },
      {
        to: '/dev/rate-limit-logs',
        label: 'Rate Limits',
        icon: FiShield,
        description: 'Request yang ditolak limiter',
      },
      {
        to: '/dev/server-logs',
        label: 'Server Logs',
        icon: FiTerminal,
        description: 'Error dan warning proses server',
      },
      {
        to: '/dev/audit',
        label: 'Audit Log',
        icon: FiClipboard,
        description: 'Jejak aksi admin: role, ban, settings, purge',
      },
      {
        to: '/dev/file-health',
        label: 'File Health',
        icon: FiFileText,
        description: 'Ukuran file vs limit, risiko konteks agent',
      },
    ],
  },
  {
    label: 'Tools',
    items: [
      {
        to: '/dev/tools',
        label: 'Tools & MCP',
        icon: FiTool,
        description: 'Akses agent, status proses, reset cache',
      },
      {
        to: '/dev/engines',
        label: 'Engines',
        icon: FiCpu,
        description: 'Status model STT/TTS, warmup dan unload',
      },
      {
        to: '/dev/playground',
        label: 'Playground',
        icon: FiMic,
        description: 'Coba transkripsi dan sintesis suara langsung',
      },
      {
        to: '/dev/changelog',
        label: 'Changelog',
        icon: FiTag,
        description: 'Riwayat perubahan per versi',
      },
    ],
  },
  {
    label: 'Konfigurasi',
    items: [
      {
        to: '/dev/settings',
        label: 'Settings',
        icon: FiSettings,
        description: 'Autentikasi, rate limit, runtime',
      },
    ],
  },
];
const OTHER: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: FiHome },
  { to: '/profile', label: 'Profile', icon: FiUser },
];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireRole(request, ROLES.SUPER_ADMIN);
  // Sidebar counters — cached briefly server-side, every source fails soft.
  const navBadges = await devSidebarBadges();
  return { ...auth, collapsed: getSidebarCollapsed(request), navBadges, ...(await frameInfo()) };
}

function Frame({
  data,
  children,
}: {
  data: Route.ComponentProps['loaderData'];
  children: React.ReactNode;
}) {
  return (
    <AppFrame
      navItems={NAV}
      secondaryNav={OTHER}
      navBadges={data.navBadges}
      consoleLabel="Dev Console"
      env={data.env}
      branding={data.branding}
      maintenance={data.maintenance}
      version={data.version}
      role={data.role}
      user={data.user}
      badgeColor="grape"
      initialCollapsed={data.collapsed}
    >
      {children}
    </AppFrame>
  );
}

export default function SuperLayout({ loaderData }: Route.ComponentProps) {
  const ctx: AppContext = { user: loaderData.user, role: loaderData.role };
  return (
    <Frame data={loaderData}>
      <Outlet context={ctx} />
    </Frame>
  );
}

/** A failing console page keeps the sidebar; the panel explains and offers a way out. */
export function ErrorBoundary({ error, loaderData }: Route.ErrorBoundaryProps) {
  return (
    <AreaErrorBoundary error={error} homePath="/dev" homeLabel="Ke overview">
      {loaderData ? (node) => <Frame data={loaderData}>{node}</Frame> : undefined}
    </AreaErrorBoundary>
  );
}
