import { ActionIcon, Badge, Group, Stack, Text, Tooltip } from '@mantine/core';
import { FiZap } from 'react-icons/fi';
import { TbLayoutSidebarLeftCollapse, TbLayoutSidebarLeftExpand } from 'react-icons/tb';
import { Link } from 'react-router';

type Props = {
  collapsed: boolean;
  onToggle: () => void;
  homePath: string;
  /** Area name under the brand, e.g. "Dev Console". */
  consoleLabel?: string;
  /** Runtime environment; "production" is highlighted so nobody edits prod by accident. */
  env?: string;
  version?: string;
  /** Extra icon control (theme toggle) shown beside the collapse button. */
  extra?: React.ReactNode;
  appName?: string;
};

const ENV_COLOR: Record<string, string> = {
  production: 'red',
  development: 'teal',
  test: 'yellow',
};

/** Brand + area label + environment chip, with the collapse toggle. */
export function BrandHeader({
  collapsed,
  onToggle,
  homePath,
  consoleLabel,
  env,
  version,
  extra,
  appName = 'st4s',
}: Props) {
  const toggle = (
    <Tooltip label={collapsed ? 'Perlebar sidebar' : 'Ciutkan sidebar'} position="right" withArrow>
      <ActionIcon
        variant="subtle"
        color="gray"
        onClick={onToggle}
        aria-label={collapsed ? 'Perlebar sidebar' : 'Ciutkan sidebar'}
        aria-expanded={!collapsed}
      >
        {collapsed ? (
          <TbLayoutSidebarLeftExpand size={20} />
        ) : (
          <TbLayoutSidebarLeftCollapse size={20} />
        )}
      </ActionIcon>
    </Tooltip>
  );

  if (collapsed) {
    return (
      <Stack gap={4} align="center">
        <Tooltip
          label={`${appName}${version ? ` v${version}` : ''}${consoleLabel ? ` · ${consoleLabel}` : ''}`}
          position="right"
          withArrow
        >
          <ActionIcon
            component={Link}
            to={homePath}
            variant="subtle"
            color="gray"
            size="lg"
            aria-label="Beranda"
          >
            <FiZap size={20} />
          </ActionIcon>
        </Tooltip>
        {extra}
        {toggle}
      </Stack>
    );
  }

  return (
    <Group justify="space-between" wrap="nowrap" gap="xs" align="flex-start">
      <Link to={homePath} style={{ textDecoration: 'none', color: 'inherit', minWidth: 0 }}>
        <Group gap={8} wrap="nowrap" align="flex-start">
          <FiZap size={22} style={{ marginTop: 2, flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <Group gap={6} wrap="nowrap">
              <Text fw={700} size="lg" lh={1.2} truncate>
                {appName}
              </Text>
              {env && env !== 'development' && (
                <Badge size="xs" variant="light" color={ENV_COLOR[env] ?? 'gray'}>
                  {env}
                </Badge>
              )}
            </Group>
            {consoleLabel && (
              <Text size="xs" c="dimmed" lh={1.2} truncate>
                {consoleLabel}
                {version ? ` · v${version}` : ''}
              </Text>
            )}
          </div>
        </Group>
      </Link>
      <Group gap={2} wrap="nowrap">
        {extra}
        {toggle}
      </Group>
    </Group>
  );
}
