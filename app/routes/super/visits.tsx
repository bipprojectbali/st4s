import { Alert, Box, Button, Collapse, Group, Pagination, Paper, Stack, Text } from '@mantine/core';
import { useDebouncedValue, useLocalStorage } from '@mantine/hooks';
import { listVisits } from '@server/api/analytics-visits.query';
import { getVisitStats } from '@server/api/analytics-visits.stats.query';
import { requireRole } from '@server/guard';
import { ROLES } from '@server/permissions';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { FiAlertCircle, FiChevronDown, FiChevronUp } from 'react-icons/fi';
import { LogPageHeader } from '~/components/logs/LogPageHeader';
import { SelectionBar } from '~/components/logs/SelectionBar';
import { useVisitActions } from '~/components/visits/useVisitActions';
import { VisitBreakdown } from '~/components/visits/VisitBreakdown';
import { VisitCardList } from '~/components/visits/VisitCardList';
import { VisitDetailDrawer } from '~/components/visits/VisitDetailDrawer';
import { VisitEmptyState } from '~/components/visits/VisitEmptyState';
import { VisitFilters } from '~/components/visits/VisitFilters';
import { VisitStatsCards } from '~/components/visits/VisitStatsCards';
import { VisitTable } from '~/components/visits/VisitTable';
import { toJson } from '~/lib/loader-json';
import {
  DEFAULT_FILTERS,
  exportVisitsUrl,
  type VisitFilters as Filters,
  fetchVisitStats,
  fetchVisits,
  hasActiveFilters,
  type VisitListResponse,
  type VisitRow,
  type VisitStats,
} from '~/lib/visits-api';
import type { Route } from './+types/visits';

export function meta() {
  return [{ title: 'Visitor Logs — st4s' }];
}

const LIMIT = 25;

/** SSR the default view (page 1, newest first) so the table is filled at first paint. */
export async function loader({ request }: Route.LoaderArgs) {
  await requireRole(request, ROLES.SUPER_ADMIN);
  const [list, stats] = await Promise.all([
    listVisits({ page: '1', limit: String(LIMIT), sort: 'desc' }),
    getVisitStats(),
  ]);
  return {
    list: toJson<VisitListResponse>(list),
    stats: toJson<VisitStats>(stats),
    loadedAt: Date.now(),
  };
}
const nf = new Intl.NumberFormat('id-ID');

export default function VisitsPage({ loaderData }: Route.ComponentProps) {
  const [filters, setFiltersState] = useState<Filters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<'asc' | 'desc'>('desc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<VisitRow | null>(null);
  const [showSummary, setShowSummary] = useLocalStorage({
    key: 'mk-visits-summary',
    defaultValue: true,
  });
  const [debouncedSearch] = useDebouncedValue(filters.search, 300);

  const params = { ...filters, search: debouncedSearch, page, limit: LIMIT, sort };
  const filtered = hasActiveFilters(filters);
  const list = useQuery({
    queryKey: ['visits', params],
    queryFn: () => fetchVisits(params),
    placeholderData: keepPreviousData,
    // First paint uses SSR data; only the default view matches the loader's query.
    initialData: !filtered && page === 1 && sort === 'desc' ? loaderData.list : undefined,
    initialDataUpdatedAt: loaderData.loadedAt,
  });
  const stats = useQuery({
    queryKey: ['visits-stats'],
    queryFn: fetchVisitStats,
    initialData: loaderData.stats,
    initialDataUpdatedAt: loaderData.loadedAt,
  });

  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  const resetSelection = () => setSelected(new Set());
  const setFilters = (patch: Partial<Filters>) => {
    setFiltersState((f) => ({ ...f, ...patch }));
    setPage(1);
    resetSelection();
  };
  const resetFilters = () => setFilters(DEFAULT_FILTERS);

  const actions = useVisitActions({
    onDone: () => {
      resetSelection();
      setDetail(null);
    },
  });

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = () =>
    setSelected((s) =>
      rows.every((r) => s.has(r.id)) ? new Set() : new Set(rows.map((r) => r.id)),
    );

  const listHandlers = {
    selected,
    onToggle: toggle,
    onToggleAll: toggleAll,
    onOpen: setDetail,
    onDelete: actions.deleteOne,
    deletingId: actions.deletingId,
  };
  const empty = <VisitEmptyState filtered={filtered} onReset={resetFilters} />;
  const refresh = () => {
    list.refetch();
    stats.refetch();
  };

  return (
    <Stack gap="md" p={{ base: 'sm', md: 'md' }}>
      <LogPageHeader
        title="Visitor Logs"
        description="Setiap kunjungan halaman beserta lokasi, perangkat, sumber, dan user yang login."
        exportHref={exportVisitsUrl(filters)}
        exportMaxRows={10_000}
        canExport={total > 0}
        refreshing={list.isFetching}
        onRefresh={refresh}
        hasData={(stats.data?.total ?? 0) > 0}
        onPurgeOld={actions.purgeOld}
        onClearAll={actions.clearAll}
      />

      <VisitStatsCards stats={stats.data} />

      {stats.data && stats.data.total > 0 && (
        <Stack gap="xs">
          <Button
            variant="subtle"
            color="gray"
            size="compact-sm"
            rightSection={showSummary ? <FiChevronUp size={14} /> : <FiChevronDown size={14} />}
            onClick={() => setShowSummary((v) => !v)}
            style={{ alignSelf: 'flex-start' }}
          >
            {showSummary ? 'Sembunyikan ringkasan' : 'Tampilkan ringkasan'}
          </Button>
          <Collapse expanded={showSummary}>
            <VisitBreakdown
              stats={stats.data}
              onCountry={(c) => setFilters({ country: c })}
              onDevice={(d) => setFilters({ device: d })}
            />
          </Collapse>
        </Stack>
      )}

      <VisitFilters
        filters={filters}
        onChange={setFilters}
        onReset={resetFilters}
        countries={stats.data?.topCountries ?? []}
        matchCount={list.data?.total}
      />

      {list.isError && (
        <Alert color="red" icon={<FiAlertCircle size={16} />} title="Gagal memuat visitor logs">
          <Group justify="space-between" wrap="wrap" gap="xs">
            <Text size="sm">{(list.error as Error).message}</Text>
            <Button size="xs" variant="light" color="red" onClick={() => list.refetch()}>
              Coba lagi
            </Button>
          </Group>
        </Alert>
      )}

      <SelectionBar
        count={selected.size}
        noun="kunjungan"
        deleting={actions.bulkDeleting}
        onClear={resetSelection}
        onDelete={() => actions.deleteMany([...selected])}
      />

      <Paper withBorder radius="md" visibleFrom="sm" style={{ overflow: 'hidden' }}>
        <VisitTable
          rows={rows}
          loading={list.isPending}
          fetching={list.isFetching}
          sort={sort}
          onToggleSort={() => {
            setSort((s) => (s === 'desc' ? 'asc' : 'desc'));
            setPage(1);
          }}
          empty={empty}
          {...listHandlers}
        />
      </Paper>
      <Box hiddenFrom="sm">
        <VisitCardList rows={rows} loading={list.isPending} empty={empty} {...listHandlers} />
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
            onChange={(p) => {
              setPage(p);
              resetSelection();
            }}
            size="sm"
            siblings={1}
          />
        )}
      </Group>

      <VisitDetailDrawer
        row={detail}
        onClose={() => setDetail(null)}
        onDelete={actions.deleteOne}
        deleting={detail !== null && actions.deletingId === detail.id}
      />
    </Stack>
  );
}
