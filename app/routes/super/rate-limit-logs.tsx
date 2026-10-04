import { Alert, Box, Button, Collapse, Group, Pagination, Paper, Stack, Text } from '@mantine/core';
import { useDebouncedValue, useLocalStorage } from '@mantine/hooks';
import { listRateLimits } from '@server/api/analytics-ratelimits.query';
import { getRateLimitStats } from '@server/api/analytics-ratelimits.stats.query';
import { requireRole } from '@server/guard';
import { ROLES } from '@server/permissions';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { FiAlertCircle, FiChevronDown, FiChevronUp, FiInfo } from 'react-icons/fi';
import { LogPageHeader } from '~/components/logs/LogPageHeader';
import { SelectionBar } from '~/components/logs/SelectionBar';
import { RateLimitBreakdown } from '~/components/rate-limit-logs/RateLimitBreakdown';
import { RateLimitCardList } from '~/components/rate-limit-logs/RateLimitCardList';
import { RateLimitDetailDrawer } from '~/components/rate-limit-logs/RateLimitDetailDrawer';
import { RateLimitFilters } from '~/components/rate-limit-logs/RateLimitFilters';
import { RateLimitStatsCards } from '~/components/rate-limit-logs/RateLimitStatsCards';
import { RateLimitTable } from '~/components/rate-limit-logs/RateLimitTable';
import { useRateLimitActions } from '~/components/rate-limit-logs/useRateLimitActions';
import { VisitEmptyState } from '~/components/visits/VisitEmptyState';
import { toJson } from '~/lib/loader-json';
import {
  DEFAULT_RATE_LIMIT_FILTERS,
  exportRateLimitsUrl,
  type RateLimitFilters as Filters,
  fetchRateLimitStats,
  fetchRateLimits,
  formatWindow,
  hasActiveRateLimitFilters,
  type RateLimitListResponse,
  type RateLimitRow,
  type RateLimitStats,
} from '~/lib/rate-limit-logs-api';
import type { Route } from './+types/rate-limit-logs';

export function meta() {
  return [{ title: 'Rate Limit Logs — st4s' }];
}

const LIMIT = 25;

/** SSR the default view (page 1, newest first) so the table is filled at first paint. */
export async function loader({ request }: Route.LoaderArgs) {
  await requireRole(request, ROLES.SUPER_ADMIN);
  const [list, stats] = await Promise.all([
    listRateLimits({ page: '1', limit: String(LIMIT), sort: 'desc' }),
    getRateLimitStats(),
  ]);
  return {
    list: toJson<RateLimitListResponse>(list),
    stats: toJson<RateLimitStats>(stats),
    loadedAt: Date.now(),
  };
}
const nf = new Intl.NumberFormat('id-ID');

export default function RateLimitLogsPage({ loaderData }: Route.ComponentProps) {
  const [filters, setFiltersState] = useState<Filters>(DEFAULT_RATE_LIMIT_FILTERS);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<'asc' | 'desc'>('desc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<RateLimitRow | null>(null);
  const [showSummary, setShowSummary] = useLocalStorage({
    key: 'mk-ratelimits-summary',
    defaultValue: true,
  });
  const [debouncedSearch] = useDebouncedValue(filters.search, 300);

  const params = { ...filters, search: debouncedSearch, page, limit: LIMIT, sort };
  const filtered = hasActiveRateLimitFilters(filters);
  const list = useQuery({
    queryKey: ['rate-limit-logs', params],
    queryFn: () => fetchRateLimits(params),
    placeholderData: keepPreviousData,
    // First paint uses SSR data; only the default view matches the loader's query.
    initialData: !filtered && page === 1 && sort === 'desc' ? loaderData.list : undefined,
    initialDataUpdatedAt: loaderData.loadedAt,
  });
  const stats = useQuery({
    queryKey: ['rate-limit-logs-stats'],
    queryFn: fetchRateLimitStats,
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
  const resetFilters = () => setFilters(DEFAULT_RATE_LIMIT_FILTERS);
  const actions = useRateLimitActions({
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
  const cfg = stats.data?.config;

  return (
    <Stack gap="md" p={{ base: 'sm', md: 'md' }}>
      <LogPageHeader
        title="Rate Limit Logs"
        description="Setiap request API yang ditolak karena melampaui batas: siapa, endpoint mana, dari mana, dan perangkat apa."
        exportHref={exportRateLimitsUrl(filters)}
        exportMaxRows={10_000}
        canExport={total > 0}
        refreshing={list.isFetching}
        onRefresh={refresh}
        hasData={(stats.data?.total ?? 0) > 0}
        onPurgeOld={actions.purgeOld}
        onClearAll={actions.clearAll}
      />

      <RateLimitStatsCards stats={stats.data} />

      {cfg && (
        <Alert
          color="blue"
          variant="light"
          icon={<FiInfo size={16} />}
          title={`Batas aktif: ${nf.format(cfg.limit)} request per ${formatWindow(cfg.windowMs)} per IP`}
        >
          <Text size="sm">
            Jendela geser per IP klien. Request yang ditolak tidak memperpanjang jendela, jadi klien
            yang menunggu sesuai header <code>Retry-After</code> pasti diterima kembali.
            Dikecualikan: <code>{cfg.excludePrefixes.join(', ')}</code>. Ubah lewat{' '}
            <code>RATE_LIMIT_MAX</code> dan <code>RATE_LIMIT_WINDOW_MS</code> di env.
          </Text>
        </Alert>
      )}

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
            <RateLimitBreakdown
              stats={stats.data}
              onIp={(ip) => setFilters({ ip })}
              onPath={(path) => setFilters({ path })}
              onMethod={(method) => setFilters({ method })}
              onCountry={(country) => setFilters({ country })}
              onDevice={(device) => setFilters({ device })}
            />
          </Collapse>
        </Stack>
      )}

      <RateLimitFilters
        filters={filters}
        onChange={setFilters}
        onReset={resetFilters}
        stats={stats.data}
        matchCount={list.data?.total}
      />

      {list.isError && (
        <Alert color="red" icon={<FiAlertCircle size={16} />} title="Gagal memuat rate limit logs">
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
        noun="catatan"
        deleting={actions.bulkDeleting}
        onClear={resetSelection}
        onDelete={() => actions.deleteMany([...selected])}
      />

      <Paper withBorder radius="md" visibleFrom="sm" style={{ overflow: 'hidden' }}>
        <RateLimitTable
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
        <RateLimitCardList rows={rows} loading={list.isPending} empty={empty} {...listHandlers} />
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

      <RateLimitDetailDrawer
        row={detail}
        onClose={() => setDetail(null)}
        onDelete={actions.deleteOne}
        onFilterIp={(ip) => {
          setDetail(null);
          setFilters({ ip });
        }}
        deleting={detail !== null && actions.deletingId === detail.id}
      />
    </Stack>
  );
}
