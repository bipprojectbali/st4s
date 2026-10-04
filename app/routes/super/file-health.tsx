import { Alert, Button, Group, Pagination, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { FiAlertCircle, FiFilter, FiRefreshCw } from 'react-icons/fi';
import { FileHealthFilters } from '~/components/file-health/FileHealthFilters';
import { FileHealthHazards } from '~/components/file-health/FileHealthHazards';
import { FileHealthStats } from '~/components/file-health/FileHealthStats';
import { FileHealthTable } from '~/components/file-health/FileHealthTable';
import {
  DEFAULT_FILE_FILTERS,
  FILE_PAGE_SIZE,
  type FileHealthFilters as Filters,
  fetchFileHealth,
  fmtNum,
} from '~/lib/file-health-api';

export function meta() {
  return [{ title: 'File Health — st4s' }];
}

export default function FileHealthPage() {
  const [filters, setFiltersState] = useState<Filters>(DEFAULT_FILE_FILTERS);
  const [page, setPage] = useState(1);
  const [debouncedSearch] = useDebouncedValue(filters.search, 300);
  const [refresh, setRefresh] = useState(0);
  const effective = { ...filters, search: debouncedSearch };

  const setFilters = (patch: Partial<Filters>) => {
    setFiltersState((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  const q = useQuery({
    queryKey: ['file-health', effective, page, refresh],
    // refresh > 0 bypasses the server-side 30s cache (manual "Pindai ulang").
    queryFn: () => fetchFileHealth(effective, page, refresh > 0),
    placeholderData: keepPreviousData,
  });

  const data = q.data;
  const active =
    filters.search.trim() !== '' ||
    filters.status !== 'all' ||
    filters.kind !== null ||
    filters.hazard !== null;

  const empty = (
    <Stack align="center" gap="xs" py="xl">
      <ThemeIcon variant="light" color="gray" size={48} radius="xl">
        <FiFilter size={22} />
      </ThemeIcon>
      <Text fw={600}>{active ? 'Tidak ada file yang cocok' : 'Tidak ada file terpindai'}</Text>
      {active && (
        <Button variant="light" size="sm" onClick={() => setFilters(DEFAULT_FILE_FILTERS)}>
          Reset filter
        </Button>
      )}
    </Stack>
  );

  return (
    <Stack gap="md" p={{ base: 'sm', md: 'md' }}>
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Title order={3}>File Health</Title>
          <Text size="sm" c="dimmed">
            Ukuran file vs. limit baris per peran, plus file yang berbahaya bagi konteks AI agent.
          </Text>
        </div>
        <Group gap="xs" wrap="wrap" justify="flex-end">
          {data && (
            <Text size="xs" c="dimmed">
              Dipindai {new Date(data.scannedAt).toLocaleTimeString('id-ID')} · {data.durationMs} ms
            </Text>
          )}
          <Button
            size="sm"
            variant="light"
            leftSection={<FiRefreshCw size={14} />}
            loading={q.isFetching}
            onClick={() => setRefresh((n) => n + 1)}
          >
            Pindai ulang
          </Button>
        </Group>
      </Group>

      {data && !data.available && (
        <Alert color="yellow" icon={<FiAlertCircle size={16} />} title="Pemindaian tidak tersedia">
          {data.reason}
        </Alert>
      )}
      {q.isError && (
        <Alert color="red" icon={<FiAlertCircle size={16} />} title="Gagal memuat file health">
          <Group justify="space-between" wrap="wrap" gap="xs">
            <Text size="sm">{(q.error as Error).message}</Text>
            <Button size="xs" variant="light" color="red" onClick={() => q.refetch()}>
              Coba lagi
            </Button>
          </Group>
        </Alert>
      )}

      <FileHealthStats summary={data?.summary} />

      {data?.available && (
        <FileHealthHazards
          rows={data.hazards}
          cautionTokens={data.rules.cautionTokens}
          dangerTokens={data.rules.dangerTokens}
        />
      )}

      <FileHealthFilters
        filters={filters}
        onChange={setFilters}
        summary={data?.summary}
        matchCount={data?.total}
      />

      <FileHealthTable rows={data?.rows ?? []} loading={q.isPending} empty={empty} />

      {data && data.total > 0 && (
        <Group justify="space-between" align="center" wrap="wrap" gap="xs">
          <Text size="xs" c="dimmed">
            Menampilkan {fmtNum((page - 1) * FILE_PAGE_SIZE + 1)}–
            {fmtNum(Math.min(page * FILE_PAGE_SIZE, data.total))} dari {fmtNum(data.total)} file
          </Text>
          {data.total > FILE_PAGE_SIZE && (
            <Pagination
              value={page}
              total={Math.ceil(data.total / FILE_PAGE_SIZE)}
              onChange={setPage}
              size="sm"
              siblings={1}
            />
          )}
        </Group>
      )}

      {data && (
        <Text size="xs" c="dimmed">
          Limit per jenis: route/handler {data.rules.kindLimits.route} · service{' '}
          {data.rules.kindLimits.service} · repository {data.rules.kindLimits.repository} · schema{' '}
          {data.rules.kindLimits.schema} · types {data.rules.kindLimits.types} · utility{' '}
          {data.rules.kindLimits.utility} · config {data.rules.kindLimits.config} · test{' '}
          {data.rules.kindLimits.test} · page/component {data.rules.kindLimits.component}. Hard
          limit global {data.rules.hardLimitLines} baris /{' '}
          {data.rules.hardLimitChars.toLocaleString('id-ID')} karakter. Migration, generated, seed,
          fixture, lockfile, dan skill vendor dikecualikan.
        </Text>
      )}
    </Stack>
  );
}
