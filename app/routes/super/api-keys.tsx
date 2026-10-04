import {
  Alert,
  Box,
  Button,
  Group,
  Pagination,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { keyStats, listKeys } from '@server/api-keys/query';
import { SCOPES } from '@server/api-keys/scopes';
import { requireRole } from '@server/guard';
import { ROLES } from '@server/permissions';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { FiAlertCircle, FiPlus, FiRefreshCw } from 'react-icons/fi';
import { useSearchParams } from 'react-router';
import { ApiKeyDetailDrawer } from '~/components/api-keys/ApiKeyDetailDrawer';
import { ApiKeyFilterBar } from '~/components/api-keys/ApiKeyFilterBar';
import { ApiKeyFormModal } from '~/components/api-keys/ApiKeyFormModal';
import { ApiKeyStatsCards } from '~/components/api-keys/ApiKeyStatsCards';
import { ApiKeyCardList, ApiKeyTable } from '~/components/api-keys/ApiKeyTable';
import { RevealKeyModal } from '~/components/api-keys/RevealKeyModal';
import { UsageLogSection } from '~/components/api-keys/UsageLogSection';
import { useApiKeyActions } from '~/components/api-keys/useApiKeyActions';
import { VisitEmptyState } from '~/components/visits/VisitEmptyState';
import {
  type ApiKeyListResponse,
  type ApiKeyRow,
  type ApiKeyStats,
  adminKeyClient,
  DEFAULT_KEY_FILTERS,
  type ApiKeyFilters as Filters,
  fetchApiKeyStats,
  fetchApiKeys,
  hasActiveKeyFilters,
  type ScopeDef,
} from '~/lib/api-keys-api';
import { toJson } from '~/lib/loader-json';
import type { Route } from './+types/api-keys';

export function meta() {
  return [{ title: 'API Keys — st4s' }];
}

const LIMIT = 25;
const nf = new Intl.NumberFormat('id-ID');

export async function loader({ request }: Route.LoaderArgs) {
  await requireRole(request, ROLES.SUPER_ADMIN);
  const [list, stats] = await Promise.all([
    listKeys({ page: '1', limit: String(LIMIT) }),
    keyStats(),
  ]);
  return {
    list: toJson<ApiKeyListResponse>(list),
    stats: toJson<ApiKeyStats>(stats),
    scopes: SCOPES as unknown as ScopeDef[],
    loadedAt: Date.now(),
  };
}

export default function ApiKeysPage({ loaderData }: Route.ComponentProps) {
  const [filters, setFiltersState] = useState<Filters>(DEFAULT_KEY_FILTERS);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ApiKeyRow | null>(null);
  const [view, setView] = useState<'keys' | 'usage'>('keys');
  const [searchParams, setSearchParams] = useSearchParams();
  const [debouncedSearch] = useDebouncedValue(filters.search, 300);
  const params = { ...filters, search: debouncedSearch, page, limit: LIMIT };
  const filtered = hasActiveKeyFilters(filters);
  const list = useQuery({
    queryKey: ['api-keys', params],
    queryFn: () => fetchApiKeys(params),
    placeholderData: keepPreviousData,
    initialData: !filtered && page === 1 ? loaderData.list : undefined,
    initialDataUpdatedAt: loaderData.loadedAt,
  });
  const stats = useQuery({
    queryKey: ['api-keys-stats'],
    queryFn: fetchApiKeyStats,
    initialData: loaderData.stats,
    initialDataUpdatedAt: loaderData.loadedAt,
  });
  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const soonDays = stats.data?.expiringSoonDays ?? 7;
  const setFilters = (patch: Partial<Filters>) => {
    setFiltersState((f) => ({ ...f, ...patch }));
    setPage(1);
  };
  const actions = useApiKeyActions();
  // /dev/api-keys?new=mcp (from Tools & MCP) opens the create form with the mcp scope preset.
  const presetScope = searchParams.get('new');
  useEffect(() => {
    if (!presetScope) return;
    actions.openCreate({ name: presetScope === 'mcp' ? 'agent-mcp' : '', scopes: [presetScope] });
    setSearchParams({}, { replace: true });
  }, [presetScope, actions.openCreate, setSearchParams]);
  // Keep the drawer in sync after toggle/rotate/revoke without closing it.
  const current = selected ? (rows.find((r) => r.id === selected.id) ?? selected) : null;
  const handlers = {
    busyId: actions.busyId,
    onOpen: setSelected,
    onEdit: actions.onEdit,
    onToggle: actions.onToggle,
    onRotate: actions.onRotate,
    onRevoke: actions.onRevoke,
    onDelete: (k: ApiKeyRow) => {
      if (selected?.id === k.id) setSelected(null);
      actions.onDelete(k);
    },
    onFilterOwner: (ownerId: string) => setFilters({ ownerId }),
  };
  const ownerLabel = filters.ownerId
    ? (rows.find((r) => r.ownerId === filters.ownerId)?.ownerEmail ?? filters.ownerId)
    : null;
  const empty = (
    <VisitEmptyState filtered={filtered} onReset={() => setFilters(DEFAULT_KEY_FILTERS)} />
  );

  return (
    <Stack gap="md" p={{ base: 'sm', md: 'md' }}>
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Title order={3}>API Keys</Title>
          <Text size="sm" c="dimmed">
            Akses terprogram ke API dengan scope, kedaluwarsa, rotasi, dan jejak pemakaian. Kirim
            lewat header X-API-Key.
          </Text>
        </div>
        <Group gap="xs" wrap="wrap" justify="flex-end">
          <Button
            size="sm"
            variant="light"
            leftSection={<FiRefreshCw size={14} />}
            loading={list.isFetching}
            onClick={() => {
              list.refetch();
              stats.refetch();
            }}
          >
            Refresh
          </Button>
          <Button size="sm" leftSection={<FiPlus size={14} />} onClick={() => actions.openCreate()}>
            Buat kunci
          </Button>
        </Group>
      </Group>

      <ApiKeyStatsCards stats={stats.data} />

      <SegmentedControl
        size="sm"
        w={{ base: '100%', sm: 'auto' }}
        value={view}
        onChange={(v) => setView(v as 'keys' | 'usage')}
        data={[
          { value: 'keys', label: 'Kunci' },
          { value: 'usage', label: 'Log penggunaan' },
        ]}
      />
      {view === 'usage' && <UsageLogSection />}
      {view === 'keys' && (
        <>
          <ApiKeyFilterBar
            filters={filters}
            setFilters={setFilters}
            scopes={loaderData.scopes}
            total={total}
            filtered={filtered}
            ownerLabel={ownerLabel}
          />

          {list.isError && (
            <Alert color="red" icon={<FiAlertCircle size={16} />} title="Gagal memuat kunci">
              {(list.error as Error).message}
            </Alert>
          )}

          <Paper withBorder radius="md" visibleFrom="sm" style={{ overflow: 'hidden' }}>
            <ApiKeyTable
              rows={rows}
              loading={list.isPending}
              fetching={list.isFetching}
              empty={empty}
              soonDays={soonDays}
              {...handlers}
            />
          </Paper>
          <Box hiddenFrom="sm">
            <ApiKeyCardList
              rows={rows}
              loading={list.isPending}
              empty={empty}
              soonDays={soonDays}
              {...handlers}
            />
          </Box>

          <Group justify="space-between" align="center" wrap="wrap" gap="xs">
            <Text size="xs" c="dimmed">
              {total > 0
                ? `Menampilkan ${nf.format((page - 1) * LIMIT + 1)}–${nf.format(Math.min(page * LIMIT, total))} dari ${nf.format(total)}`
                : 'Tidak ada hasil'}
            </Text>
            {totalPages > 1 && (
              <Pagination
                value={page}
                total={totalPages}
                onChange={setPage}
                size="sm"
                siblings={1}
              />
            )}
          </Group>
        </>
      )}

      <ApiKeyDetailDrawer
        keyRow={current}
        onClose={() => setSelected(null)}
        soonDays={soonDays}
        fetchUsage={adminKeyClient.usage}
        h={handlers}
      />
      <ApiKeyFormModal
        state={actions.form}
        scopes={loaderData.scopes}
        client={adminKeyClient}
        onClose={actions.closeForm}
        onCreated={actions.setReveal}
        onSaved={actions.invalidate}
      />
      <RevealKeyModal reveal={actions.reveal} onClose={actions.closeReveal} />
    </Stack>
  );
}
