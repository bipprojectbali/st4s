import { frameInfo } from '@server/app-info';
import { requireAnyRole } from '@server/guard';
import { ROLES } from '@server/permissions';
import { getSidebarCollapsed } from '@server/sidebar';
import { FiGrid, FiHome, FiUser } from 'react-icons/fi';
import { Outlet } from 'react-router';
import { AppFrame, type NavItem } from '~/components/AppFrame';
import { AreaErrorBoundary } from '~/components/errors/AreaErrorBoundary';
import type { AppContext } from '~/lib/app-context';
import type { Route } from './+types/layout';

export function meta(_: Route.MetaArgs) {
  return [{ title: 'st4s' }];
}

const NAV: NavItem[] = [{ to: '/profile', label: 'Profile', icon: FiUser }];

const SECONDARY_NAV: Record<string, NavItem[]> = {
  admin: [{ to: '/dashboard', label: 'Dashboard', icon: FiHome }],
  'super-admin': [
    { to: '/dev', label: 'Dev Console', icon: FiGrid },
    { to: '/dashboard', label: 'Dashboard', icon: FiHome },
  ],
};

const BADGE_COLOR: Record<string, string> = {
  user: 'gray',
  admin: 'blue',
  'super-admin': 'grape',
};

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAnyRole(request, [ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN]);
  return { ...auth, collapsed: getSidebarCollapsed(request), ...(await frameInfo()) };
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
      secondaryNav={SECONDARY_NAV[data.role]}
      role={data.role}
      user={data.user}
      badgeColor={BADGE_COLOR[data.role] ?? 'gray'}
      consoleLabel="Akun"
      env={data.env}
      branding={data.branding}
      maintenance={data.maintenance}
      version={data.version}
      initialCollapsed={data.collapsed}
    >
      {children}
    </AppFrame>
  );
}

export default function UserLayout({ loaderData }: Route.ComponentProps) {
  const ctx: AppContext = { user: loaderData.user, role: loaderData.role };
  return (
    <Frame data={loaderData}>
      <Outlet context={ctx} />
    </Frame>
  );
}

export function ErrorBoundary({ error, loaderData }: Route.ErrorBoundaryProps) {
  return (
    <AreaErrorBoundary error={error} homePath="/profile" homeLabel="Ke profil">
      {loaderData ? (node) => <Frame data={loaderData}>{node}</Frame> : undefined}
    </AreaErrorBoundary>
  );
}
