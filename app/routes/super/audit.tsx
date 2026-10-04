import {
  Alert,
  Box,
  Button,
  Collapse,
  Group,
  Pagination,
  Paper,
  Stack,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { useDebouncedValue, useLocalStorage } from '@mantine/hooks';
import { auditStats, listAudit } from '@server/api/audit.query';
import { requireRole } from '@server/guard';
import { ROLES } from '@server/permissions';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  FiAlertCircle,
  FiChevronDown,
  FiChevronUp,
  FiDownload,
  FiRefreshCw,
  FiShield,
} from 'react-icons/fi';
import { AuditBreakdown } from '~/components/audit/AuditBreakdown';
import { AuditDetailDrawer } from '~/components/audit/AuditDetailDrawer';
import { AuditFilters } from '~/components/audit/AuditFilters';
import { AuditCardList, AuditTable } from '~/components/audit/AuditTable';
import { StatTileGrid } from '~/components/logs/StatTile';
import { VisitEmptyState } from '~/components/visits/VisitEmptyState';
import {
  type AuditListResponse,
  type AuditRow,
  type AuditStats,
  DEFAULT_AUDIT_FILTERS,
  exportAuditUrl,
  type AuditFilters as Filters,
  fetchAudit,
  fetchAuditStats,
  hasActiveAuditFilters,
} from '~/lib/audit-api';
import { toJson } from '~/lib/loader-json';
import type { Route } from './+types/audit';

export function meta() {
  return [{ title: 'Audit Log — st4s' }];
}

const LIMIT = 25;
const nf = new Intl.NumberFormat('id-ID');

export async function loader({ request }: Route.LoaderArgs) {
  await requireRole(request, ROLES.SUPER_ADMIN);
  const [list, stats] = await Promise.all([
    listAudit({ page: '1', limit: String(LIMIT) }),
    auditStats(),
  ]);
  return {
    list: toJson<AuditListResponse>(list),
    stats: toJson<AuditStats>(stats),
    loadedAt: Date.now(),
  };
}

export default function AuditPage({ loaderData }: Route.ComponentProps) {
  const [filters, setFiltersState] = useState<Filters>(DEFAULT_AUDIT_FILTERS);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<AuditRow | null>(null);
  const [showSummary, setShowSummary] = useLocalStorage({
    key: 'mk-audit-summary',
    defaultValue: true,
  });
  const [debouncedSearch] = useDebouncedValue(filters.search, 300);
  const params = { ...filters, search: debouncedSearch, page, limit: LIMIT };
  const filtered = hasActiveAuditFilters(filters);
  const list = useQuery({
    queryKey: ['audit', params],
    queryFn: () => fetchAudit(params),
    placeholderData: keepPreviousData,
    initialData: !filtered && page === 1 ? loaderData.list : undefined,
    initialDataUpdatedAt: loaderData.loadedAt,
  });
  const stats = useQuery({
    queryKey: ['audit-stats'],
    queryFn: fetchAuditStats,
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
  const s = stats.data;
  const tiles = s && [
    { label: 'Total entri', value: nf.format(s.total), hint: 'semua waktu', icon: FiShield },
    {
      label: '24 jam terakhir',
      value: nf.format(s.last24h),
      hint: `${nf.format(s.last7d)} dalam 7 hari`,
      icon: FiRefreshCw,
      color: 'cyan',
    },
    {
      label: 'Aksi destruktif',
      value: nf.format(s.destructive),
      hint: 'hapus user, purge, hapus log',
      icon: FiAlertCircle,
      color: s.destructive > 0 ? 'red' : 'teal',
    },
  ];
  const empty = (
    <VisitEmptyState filtered={filtered} onReset={() => setFilters(DEFAULT_AUDIT_FILTERS)} />
  );

  return (
    <Stack gap="md" p={{ base: 'sm', md: 'md' }}>
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Title order={3}>Audit Log</Title>
          <Text size="sm" c="dimmed">
            Jejak setiap aksi berhak istimewa dari konsol: siapa, apa, ke siapa, dari mana. Hanya
            bisa dibaca, tidak bisa diubah.
          </Text>
        </div>
        <Group gap="xs" wrap="wrap">
          <Tooltip label="Unduh CSV sesuai filter aktif (maks. 10.000 baris)" withArrow>
            <Button
              component="a"
              href={exportAuditUrl(filters)}
              download
              size="sm"
              variant="default"
              leftSection={<FiDownload size={14} />}
              disabled={total === 0}
              onClick={(e) => total === 0 && e.preventDefault()}
            >
              Export CSV
            </Button>
          </Tooltip>
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
      </Group>

      <StatTileGrid tiles={tiles} />

      {s && s.total > 0 && (
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
            <AuditBreakdown
              stats={s}
              onActor={(id) => setFilters({ actorId: id })}
              onAction={(a) => setFilters({ action: a })}
              onTarget={(t) => setFilters({ targetType: t })}
            />
          </Collapse>
        </Stack>
      )}

      <AuditFilters
        filters={filters}
        onChange={setFilters}
        stats={s}
        matchCount={list.data?.total}
      />

      {list.isError && (
        <Alert color="red" icon={<FiAlertCircle size={16} />} title="Gagal memuat audit log">
          {(list.error as Error).message}
        </Alert>
      )}

      <Paper withBorder radius="md" visibleFrom="sm" style={{ overflow: 'hidden' }}>
        <AuditTable
          rows={rows}
          loading={list.isPending}
          fetching={list.isFetching}
          onOpen={setDetail}
          empty={empty}
        />
      </Paper>
      <Box hiddenFrom="sm">
        <AuditCardList rows={rows} loading={list.isPending} onOpen={setDetail} empty={empty} />
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

      <AuditDetailDrawer row={detail} onClose={() => setDetail(null)} />
    </Stack>
  );
}
