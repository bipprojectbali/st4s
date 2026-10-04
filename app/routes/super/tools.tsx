import { Stack, Text, Title } from '@mantine/core';
import { requireRole } from '@server/guard';
import { ROLES } from '@server/permissions';
import { useQuery } from '@tanstack/react-query';
import { McpCard } from '~/components/tools/McpCard';
import { ApiCard, ResetCard, StatusCard } from '~/components/tools/OpsCards';
import { fetchMcpInfo, fetchOpsStatus, fetchResetTargets } from '~/lib/ops-api';
import type { Route } from './+types/tools';

export function meta() {
  return [{ title: 'Tools — st4s' }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireRole(request, ROLES.SUPER_ADMIN);
  return null;
}

export default function ToolsPage() {
  const status = useQuery({
    queryKey: ['ops-status'],
    queryFn: fetchOpsStatus,
    refetchInterval: 15_000,
  });
  const mcp = useQuery({ queryKey: ['ops-mcp'], queryFn: fetchMcpInfo });
  const targets = useQuery({ queryKey: ['ops-reset-targets'], queryFn: fetchResetTargets });
  return (
    <Stack gap="md" p={{ base: 'sm', md: 'md' }} maw={960}>
      <div>
        <Title order={3}>Tools & MCP</Title>
        <Text size="sm" c="dimmed">
          Akses untuk agent AI, ringkasan API, status proses, dan reset state untuk debugging.
        </Text>
      </div>
      <StatusCard
        status={status.data}
        onRefresh={() => status.refetch()}
        refreshing={status.isFetching}
      />
      <McpCard info={mcp.data} />
      <ApiCard />
      <ResetCard targets={targets.data} />
    </Stack>
  );
}
