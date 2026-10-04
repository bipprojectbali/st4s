import {
  ActionIcon,
  Alert,
  Anchor,
  AppShell,
  Badge,
  Burger,
  Button,
  Divider,
  Group,
  ScrollArea,
  Text,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import type { Role } from '@server/permissions';
import type { Branding } from '@server/settings-branding';
import { type ReactNode, useState } from 'react';
import { FiCornerUpLeft, FiTool, FiZap } from 'react-icons/fi';
import { Link } from 'react-router';
import type { AppUser } from '~/lib/app-context';
import { authClient, useSession } from '~/lib/auth-client';
import { BrandHeader } from './frame/BrandHeader';
import { NavList } from './frame/NavList';
import {
  homePath,
  type NavBadge,
  type NavGroup,
  type NavItem,
  normalizeNav,
  withBadges,
} from './frame/nav';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

export type { NavBadge, NavGroup, NavItem } from './frame/nav';

// Written to cookie so the server can read it on next request (no SSR flash).
const COOKIE = 'mk-sidebar-collapsed';
const WIDTH_EXPANDED = 248;
const WIDTH_COLLAPSED = 72;
/** Footer badge must never eat the name — short labels, full role in the tooltip. */
const ROLE_SHORT: Record<string, string> = { 'super-admin': 'Super', admin: 'Admin', user: 'User' };

type Props = {
  /** Flat list or labeled groups. */
  navItems: NavItem[] | NavGroup[];
  role: Role;
  user: AppUser;
  badgeColor: string;
  children: ReactNode;
  /** Cross-area links ("other apps"), pinned below primary nav. */
  secondaryNav?: NavItem[];
  /** Area name shown under the brand and in the mobile header (e.g. "Dev Console"). */
  consoleLabel?: string;
  /** Live counters keyed by route path, resolved in the layout loader. */
  navBadges?: Record<string, NavBadge>;
  env?: string;
  version?: string;
  /** App name/tagline from settings (defaults to st4s). */
  branding?: Branding;
  /** Show the maintenance banner to admins who can still use the app. */
  maintenance?: boolean;
  /**
   * Server-resolved initial collapsed state (read from cookie in the layout
   * loader). Lets the server render the correct sidebar width immediately,
   * preventing the expand→collapse flash on hard reload.
   */
  initialCollapsed?: boolean;
};

/**
 * Sidebar-only shell shared by every per-role area layout. Primary nav scrolls
 * in the grow section; cross-area links, theme toggle and the account switcher
 * are pinned to the bottom. Collapse state lives in a cookie so the server
 * renders the right width on hard reload.
 */
export function AppFrame(props: Props) {
  const {
    role,
    user,
    badgeColor,
    children,
    consoleLabel,
    env,
    version,
    branding,
    maintenance,
    initialCollapsed = false,
  } = props;
  const appName = branding?.appName ?? 'st4s';
  const [mobileOpened, { toggle: toggleMobile, close: closeMobile }] = useDisclosure();
  // Initialized from server-resolved value — no useEffect needed, no flash.
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const { data } = useSession();
  const impersonating = Boolean(
    (data?.session as { impersonatedBy?: string } | undefined)?.impersonatedBy,
  );
  const groups = withBadges(normalizeNav(props.navItems), props.navBadges);
  const secondary = normalizeNav(props.secondaryNav);
  const home = homePath(groups);

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      // Cookie persists across hard reloads; server reads it in layout loaders.
      // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API is async/Promise-based; document.cookie is intentional for synchronous set.
      document.cookie = `${COOKIE}=${next ? '1' : '0'};path=/;max-age=${365 * 24 * 3600};SameSite=Lax`;
      return next;
    });
  }

  async function stopImpersonating() {
    await authClient.admin.stopImpersonating();
    window.location.assign('/go');
  }

  return (
    <AppShell
      header={{ height: { base: 52, sm: 0 } }}
      navbar={{
        width: collapsed ? WIDTH_COLLAPSED : WIDTH_EXPANDED,
        breakpoint: 'sm',
        collapsed: { mobile: !mobileOpened },
      }}
      padding="md"
    >
      {/* Mobile-only top header — provides space + burger so content never overlaps */}
      <AppShell.Header withBorder={false} hiddenFrom="sm">
        <Group h="100%" px="md" gap="sm" wrap="nowrap">
          <Burger
            opened={mobileOpened}
            onClick={toggleMobile}
            size="sm"
            aria-label={mobileOpened ? 'Tutup navigasi' : 'Buka navigasi'}
          />
          <Link to={home} style={{ textDecoration: 'none', color: 'inherit', minWidth: 0 }}>
            <Group gap={6} wrap="nowrap">
              <FiZap size={18} />
              <Text fw={700} truncate>
                {appName}
              </Text>
              {consoleLabel && (
                <Text size="xs" c="dimmed" truncate>
                  · {consoleLabel}
                </Text>
              )}
            </Group>
          </Link>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <AppShell.Section>
          <BrandHeader
            collapsed={collapsed}
            onToggle={toggleCollapsed}
            homePath={home}
            consoleLabel={consoleLabel}
            env={env}
            version={version}
            extra={<ThemeToggle collapsed />}
            appName={appName}
          />
        </AppShell.Section>

        {impersonating && (
          <AppShell.Section mt="sm">
            {collapsed ? (
              <Tooltip label="Berhenti impersonasi" position="right" withArrow>
                <ActionIcon
                  variant="light"
                  color="orange"
                  size="lg"
                  mx="auto"
                  display="block"
                  onClick={stopImpersonating}
                  aria-label="Berhenti impersonasi"
                >
                  <FiCornerUpLeft size={18} />
                </ActionIcon>
              </Tooltip>
            ) : (
              <Button
                fullWidth
                size="xs"
                variant="light"
                color="orange"
                leftSection={<FiCornerUpLeft size={16} />}
                onClick={stopImpersonating}
              >
                Berhenti impersonasi
              </Button>
            )}
          </AppShell.Section>
        )}

        <AppShell.Section
          grow
          my="md"
          component={ScrollArea}
          type="hover"
          scrollbarSize={6}
          offsetScrollbars={false}
        >
          <NavList groups={groups} collapsed={collapsed} onNavigate={closeMobile} />
        </AppShell.Section>

        {secondary.length > 0 && (
          <AppShell.Section mb="sm">
            <Divider mb="sm" />
            <NavList
              groups={[{ label: collapsed ? undefined : 'Area lain', items: secondary[0].items }]}
              collapsed={collapsed}
              onNavigate={closeMobile}
            />
          </AppShell.Section>
        )}

        <AppShell.Section>
          <Divider mb={4} />
          <UserMenu
            user={user}
            collapsed={collapsed}
            roleBadge={
              <Tooltip label={`Role: ${role}`} withArrow>
                <Badge size="xs" variant="light" color={badgeColor} style={{ flexShrink: 0 }}>
                  {ROLE_SHORT[role] ?? role}
                </Badge>
              </Tooltip>
            }
          />
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main>
        {maintenance && (
          <Alert
            color="orange"
            variant="filled"
            icon={<FiTool size={16} />}
            mb="md"
            title="Mode maintenance aktif"
          >
            Pengunjung biasa melihat halaman pemeliharaan. Anda tetap bisa memakai konsol.{' '}
            <Anchor c="white" underline="always" component={Link} to="/dev/settings">
              Matikan di Settings
            </Anchor>
          </Alert>
        )}
        {children}
      </AppShell.Main>
    </AppShell>
  );
}
