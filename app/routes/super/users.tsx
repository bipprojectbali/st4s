import { Alert, Box, Button, Group, Pagination, Paper, Stack, Text, Title } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { adminUserStats, listAdminUsers } from '@server/api/admin-users.query';
import { requireRole } from '@server/guard';
import { ROLES } from '@server/permissions';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { FiAlertCircle, FiRefreshCw } from 'react-icons/fi';
import { UserCardList } from '~/components/users/UserCardList';
import { UserDetailDrawer } from '~/components/users/UserDetailDrawer';
import { UserFilters } from '~/components/users/UserFilters';
import { UserStatsCards } from '~/components/users/UserStatsCards';
import { UserTable } from '~/components/users/UserTable';
import { useUserActions } from '~/components/users/useUserActions';
import { VisitEmptyState } from '~/components/visits/VisitEmptyState';
import {
  type AdminUser,
  DEFAULT_USER_FILTERS,
  type UserFilters as Filters,
  fetchUserStats,
  fetchUsers,
  hasActiveUserFilters,
  type UserListResponse,
  type UserStats,
} from '~/lib/admin-users-api';
import { useApp } from '~/lib/app-context';
import { toJson } from '~/lib/loader-json';
import type { Route } from './+types/users';

export function meta() {
  return [{ title: 'Users — st4s' }];
}

const LIMIT = 25;
const nf = new Intl.NumberFormat('id-ID');

/** SSR the default view so the directory is complete at first paint. */
export async function loader({ request }: Route.LoaderArgs) {
  await requireRole(request, ROLES.SUPER_ADMIN);
  const [list, stats] = await Promise.all([
    listAdminUsers({ page: '1', limit: String(LIMIT) }),
    adminUserStats(),
  ]);
  return {
    list: toJson<UserListResponse>(list),
    stats: toJson<UserStats>(stats),
    loadedAt: Date.now(),
  };
}

export default function UsersPage({ loaderData }: Route.ComponentProps) {
  const { user: me, role: actorRole } = useApp();
  const perms = { actorRole, currentUserId: me.id };
  const [filters, setFiltersState] = useState<Filters>(DEFAULT_USER_FILTERS);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<AdminUser | null>(null);
  const [debouncedSearch] = useDebouncedValue(filters.search, 300);
  const params = { ...filters, search: debouncedSearch, page, limit: LIMIT };
  const filtered = hasActiveUserFilters(filters);

  const list = useQuery({
    queryKey: ['admin-users', params],
    queryFn: () => fetchUsers(params),
    placeholderData: keepPreviousData,
    initialData: !filtered && page === 1 ? loaderData.list : undefined,
    initialDataUpdatedAt: loaderData.loadedAt,
  });
  const stats = useQuery({
    queryKey: ['admin-users-stats'],
    queryFn: fetchUserStats,
    initialData: loaderData.stats,
    initialDataUpdatedAt: loaderData.loadedAt,
  });
  const rows = list.data?.users ?? [];
  const total = list.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  // Keep the drawer in sync after a mutation refetch.
  const detailRow = detail ? (rows.find((r) => r.id === detail.id) ?? detail) : null;

  const setFilters = (patch: Partial<Filters>) => {
    setFiltersState((f) => ({ ...f, ...patch }));
    setPage(1);
  };
  const actions = useUserActions({ onDone: () => undefined });
  const empty = (
    <VisitEmptyState filtered={filtered} onReset={() => setFilters(DEFAULT_USER_FILTERS)} />
  );
  const listProps = { rows, loading: list.isPending, perms, actions, onOpen: setDetail, empty };

  return (
    <Stack gap="md" p={{ base: 'sm', md: 'md' }}>
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Title order={3}>Users</Title>
          <Text size="sm" c="dimmed">
            Semua akun: role, status blokir, aktivitas login, dan provider yang tertaut. Super-admin
            diatur lewat env.
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

      <UserStatsCards stats={stats.data} />
      <UserFilters filters={filters} onChange={setFilters} matchCount={list.data?.total} />

      {list.isError && (
        <Alert color="red" icon={<FiAlertCircle size={16} />} title="Gagal memuat daftar user">
          <Group justify="space-between" wrap="wrap" gap="xs">
            <Text size="sm">{(list.error as Error).message}</Text>
            <Button size="xs" variant="light" color="red" onClick={() => list.refetch()}>
              Coba lagi
            </Button>
          </Group>
        </Alert>
      )}

      <Paper withBorder radius="md" visibleFrom="sm" style={{ overflow: 'hidden' }}>
        <UserTable {...listProps} fetching={list.isFetching} />
      </Paper>
      <Box hiddenFrom="sm">
        <UserCardList {...listProps} />
      </Box>

      <Group justify="space-between" align="center" wrap="wrap" gap="xs">
        <Text size="xs" c="dimmed">
          {total > 0
            ? `Menampilkan ${nf.format((page - 1) * LIMIT + 1)}–${nf.format(Math.min(page * LIMIT, total))} dari ${nf.format(total)} user`
            : 'Tidak ada hasil'}
        </Text>
        {totalPages > 1 && (
          <Pagination value={page} total={totalPages} onChange={setPage} size="sm" siblings={1} />
        )}
      </Group>

      <UserDetailDrawer
        user={detailRow}
        onClose={() => setDetail(null)}
        perms={perms}
        actions={actions}
      />
    </Stack>
  );
}
