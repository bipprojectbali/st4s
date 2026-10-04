import {
  Alert,
  Badge,
  Box,
  Button,
  CloseButton,
  Group,
  Pagination,
  Paper,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { listSessions, sessionStats } from '@server/api/sessions.query';
import { auth } from '@server/auth';
import { requireRole } from '@server/guard';
import { ROLES } from '@server/permissions';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { FiAlertCircle, FiRefreshCw, FiSearch } from 'react-icons/fi';
import { SessionStatsCards } from '~/components/sessions/SessionStatsCards';
import { SessionCardList, SessionTable } from '~/components/sessions/SessionTable';
import { useSessionActions } from '~/components/sessions/useSessionActions';
import { VisitEmptyState } from '~/components/visits/VisitEmptyState';
import { toJson } from '~/lib/loader-json';
import {
  DEFAULT_SESSION_FILTERS,
  type SessionFilters as Filters,
  fetchSessionStats,
  fetchSessions,
  hasActiveSessionFilters,
  type SessionListResponse,
  type SessionStats,
} from '~/lib/sessions-api';
import type { Route } from './+types/sessions';

export function meta() {
  return [{ title: 'Sessions — st4s' }];
}

const LIMIT = 25;
const nf = new Intl.NumberFormat('id-ID');

export async function loader({ request }: Route.LoaderArgs) {
  await requireRole(request, ROLES.SUPER_ADMIN);
  const [list, stats, own] = await Promise.all([
    listSessions({ page: '1', limit: String(LIMIT) }),
    sessionStats(),
    auth.api.getSession({ headers: request.headers }),
  ]);
  // Only the id (never the token) so the UI can mark the admin's own row.
  return {
    list: toJson<SessionListResponse>(list),
    stats: toJson<SessionStats>(stats),
    currentSessionId: own?.session.id ?? null,
    loadedAt: Date.now(),
  };
}

export default function SessionsPage({ loaderData }: Route.ComponentProps) {
  const [filters, setFiltersState] = useState<Filters>(DEFAULT_SESSION_FILTERS);
  const [page, setPage] = useState(1);
  const [debouncedSearch] = useDebouncedValue(filters.search, 300);
  const params = { ...filters, search: debouncedSearch, page, limit: LIMIT };
  const filtered = hasActiveSessionFilters(filters);
  const list = useQuery({
    queryKey: ['sessions', params],
    queryFn: () => fetchSessions(params),
    placeholderData: keepPreviousData,
    initialData: !filtered && page === 1 ? loaderData.list : undefined,
    initialDataUpdatedAt: loaderData.loadedAt,
  });
  const stats = useQuery({
    queryKey: ['sessions-stats'],
    queryFn: fetchSessionStats,
    initialData: loaderData.stats,
    initialDataUpdatedAt: loaderData.loadedAt,
  });
  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const setFilters = (patch: Partial<Filters>) => {
    setFiltersState((f) => ({ ...f, ...patch }));
    setPage(1);
  };
  const { busyId, onRevoke, onRevokeUser } = useSessionActions(loaderData.currentSessionId);
  const handlers = {
    currentSessionId: loaderData.currentSessionId,
    busyId,
    onRevoke,
    onRevokeUser,
    onFilterUser: (userId: string) => setFilters({ userId }),
  };
  const empty = (
    <VisitEmptyState filtered={filtered} onReset={() => setFilters(DEFAULT_SESSION_FILTERS)} />
  );
  const userLabel = filters.userId
    ? (rows.find((r) => r.userId === filters.userId)?.userName ?? filters.userId)
    : null;

  return (
    <Stack gap="md" p={{ base: 'sm', md: 'md' }}>
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Title order={3}>Sessions</Title>
          <Text size="sm" c="dimmed">
            Semua perangkat yang sedang masuk, lintas user. Cabut sesi yang mencurigakan atau
            keluarkan satu user dari semua perangkat.
          </Text>
        </div>
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
      </Group>

      <SessionStatsCards stats={stats.data} />

      <Paper withBorder radius="md" p="sm">
        <Group gap="xs" wrap="wrap" align="center">
          <TextInput
            placeholder="Cari nama, email, IP, atau perangkat…"
            leftSection={<FiSearch size={14} />}
            rightSection={
              filters.search ? (
                <CloseButton
                  size="sm"
                  aria-label="Bersihkan"
                  onClick={() => setFilters({ search: '' })}
                />
              ) : null
            }
            value={filters.search}
            onChange={(e) => setFilters({ search: e.currentTarget.value })}
            size="sm"
            style={{ flex: '1 1 240px', minWidth: 0 }}
          />
          <SegmentedControl
            size="sm"
            value={filters.status}
            onChange={(v) => setFilters({ status: v as Filters['status'] })}
            data={[
              { value: 'active', label: 'Aktif' },
              { value: 'expired', label: 'Kedaluwarsa' },
              { value: 'all', label: 'Semua' },
            ]}
          />
          <Switch
            size="sm"
            label="Hanya impersonasi"
            checked={filters.impersonated}
            onChange={(e) => setFilters({ impersonated: e.currentTarget.checked })}
          />
          {filters.userId && (
            <Badge
              size="lg"
              variant="light"
              rightSection={
                <CloseButton
                  size="xs"
                  aria-label="Hapus filter user"
                  onClick={() => setFilters({ userId: null })}
                />
              }
            >
              User: {userLabel}
            </Badge>
          )}
          {filtered && (
            <Button
              variant="subtle"
              color="gray"
              size="sm"
              onClick={() => setFilters(DEFAULT_SESSION_FILTERS)}
            >
              Reset filter
            </Button>
          )}
        </Group>
        <Text size="xs" c="dimmed" mt="xs">
          {nf.format(total)} sesi {filtered ? 'cocok dengan filter' : 'aktif'}
        </Text>
      </Paper>

      {list.isError && (
        <Alert color="red" icon={<FiAlertCircle size={16} />} title="Gagal memuat sesi">
          {(list.error as Error).message}
        </Alert>
      )}

      <Paper withBorder radius="md" visibleFrom="sm" style={{ overflow: 'hidden' }}>
        <SessionTable
          rows={rows}
          loading={list.isPending}
          fetching={list.isFetching}
          empty={empty}
          {...handlers}
        />
      </Paper>
      <Box hiddenFrom="sm">
        <SessionCardList rows={rows} loading={list.isPending} empty={empty} {...handlers} />
      </Box>

      <Group justify="space-between" align="center" wrap="wrap" gap="xs">
        <Text size="xs" c="dimmed">
          {total > 0
            ? `Menampilkan ${nf.format((page - 1) * LIMIT + 1)}–${nf.format(Math.min(page * LIMIT, total))} dari ${nf.format(total)}`
            : 'Tidak ada hasil'}
        </Text>
        {totalPages > 1 && (
          <Pagination value={page} total={totalPages} onChange={setPage} size="sm" siblings={1} />
        )}
      </Group>
    </Stack>
  );
}
