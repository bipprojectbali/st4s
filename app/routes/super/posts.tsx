import {
  Alert,
  Badge,
  Box,
  Button,
  CloseButton,
  Group,
  Pagination,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { listPosts, postStats } from '@server/api/posts.query';
import { requireRole } from '@server/guard';
import { ROLES } from '@server/permissions';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { FiAlertCircle, FiPlus, FiRefreshCw, FiSearch } from 'react-icons/fi';
import { PostStatsCards } from '~/components/posts/PostStatsCards';
import { PostCardList, PostTable } from '~/components/posts/PostTable';
import { usePostActions } from '~/components/posts/usePostActions';
import { VisitEmptyState } from '~/components/visits/VisitEmptyState';
import { toJson } from '~/lib/loader-json';
import {
  DEFAULT_POST_FILTERS,
  type PostFilters as Filters,
  fetchPostStats,
  fetchPosts,
  hasActivePostFilters,
  type PostListResponse,
  type PostStats,
} from '~/lib/posts-api';
import type { Route } from './+types/posts';

export function meta() {
  return [{ title: 'Posts — st4s' }];
}

const LIMIT = 25;
const nf = new Intl.NumberFormat('id-ID');
const PERIODS = [
  { value: '7', label: '7 hari terakhir' },
  { value: '30', label: '30 hari terakhir' },
  { value: 'all', label: 'Semua waktu' },
];
const SORTS = [
  { value: 'newest', label: 'Terbaru' },
  { value: 'oldest', label: 'Terlama' },
  { value: 'updated', label: 'Terakhir diubah' },
  { value: 'title', label: 'Judul A–Z' },
];

export async function loader({ request }: Route.LoaderArgs) {
  await requireRole(request, ROLES.SUPER_ADMIN);
  const [list, stats] = await Promise.all([
    listPosts({ page: '1', limit: String(LIMIT) }),
    postStats(),
  ]);
  return {
    list: toJson<PostListResponse>(list),
    stats: toJson<PostStats>(stats),
    loadedAt: Date.now(),
  };
}

export default function PostsPage({ loaderData }: Route.ComponentProps) {
  const [filters, setFiltersState] = useState<Filters>(DEFAULT_POST_FILTERS);
  const [page, setPage] = useState(1);
  const [debouncedSearch] = useDebouncedValue(filters.search, 300);
  const params = { ...filters, search: debouncedSearch, page, limit: LIMIT };
  const filtered = hasActivePostFilters(filters);
  const list = useQuery({
    queryKey: ['posts', params],
    queryFn: () => fetchPosts(params),
    placeholderData: keepPreviousData,
    initialData: !filtered && page === 1 ? loaderData.list : undefined,
    initialDataUpdatedAt: loaderData.loadedAt,
  });
  const stats = useQuery({
    queryKey: ['posts-stats'],
    queryFn: fetchPostStats,
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
  const { openForm, confirmDelete, busyId } = usePostActions();
  const authorLabel = filters.authorId
    ? (rows.find((r) => r.authorId === filters.authorId)?.authorName ??
      stats.data?.topAuthors.find((a) => a.authorId === filters.authorId)?.name ??
      filters.authorId)
    : null;
  const handlers = {
    onEdit: openForm,
    onDelete: confirmDelete,
    onAuthor: (id: string) => setFilters({ authorId: id }),
    busyId,
  };
  const empty = (
    <VisitEmptyState filtered={filtered} onReset={() => setFilters(DEFAULT_POST_FILTERS)} />
  );

  return (
    <Stack gap="md" p={{ base: 'sm', md: 'md' }}>
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Title order={3}>Posts</Title>
          <Text size="sm" c="dimmed">
            Konten contoh dari template. Pola CRUD ini bisa disalin untuk entitas nyata.
          </Text>
        </div>
        <Group gap="xs">
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
          <Button size="sm" leftSection={<FiPlus size={14} />} onClick={() => openForm(null)}>
            Post baru
          </Button>
        </Group>
      </Group>
      <PostStatsCards stats={stats.data} />
      <Paper withBorder radius="md" p="sm">
        <Group gap="xs" wrap="wrap" align="center">
          <TextInput
            placeholder="Cari judul, isi, atau penulis…"
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
          <Select
            size="sm"
            w={{ base: '100%', sm: 170 }}
            value={filters.period}
            onChange={(v) => setFilters({ period: (v as Filters['period']) ?? 'all' })}
            data={PERIODS}
            allowDeselect={false}
            aria-label="Periode"
          />
          <Select
            size="sm"
            w={{ base: '100%', sm: 170 }}
            value={filters.sort}
            onChange={(v) => setFilters({ sort: (v as Filters['sort']) ?? 'newest' })}
            data={SORTS}
            allowDeselect={false}
            aria-label="Urutkan"
          />
          {filters.authorId && (
            <Badge
              size="lg"
              variant="light"
              rightSection={
                <CloseButton
                  size="xs"
                  aria-label="Hapus filter penulis"
                  onClick={() => setFilters({ authorId: null })}
                />
              }
            >
              Penulis: {authorLabel}
            </Badge>
          )}
          {filtered && (
            <Button
              variant="subtle"
              color="gray"
              size="sm"
              onClick={() => setFilters(DEFAULT_POST_FILTERS)}
            >
              Reset filter
            </Button>
          )}
        </Group>
        <Text size="xs" c="dimmed" mt="xs">
          {nf.format(total)} post {filtered ? 'cocok dengan filter' : 'tersimpan'}
        </Text>
      </Paper>
      {list.isError && (
        <Alert color="red" icon={<FiAlertCircle size={16} />} title="Gagal memuat post">
          {(list.error as Error).message}
        </Alert>
      )}
      <Paper withBorder radius="md" visibleFrom="sm" style={{ overflow: 'hidden' }}>
        <PostTable
          rows={rows}
          loading={list.isPending}
          fetching={list.isFetching}
          empty={empty}
          {...handlers}
        />
      </Paper>
      <Box hiddenFrom="sm">
        <PostCardList rows={rows} loading={list.isPending} empty={empty} {...handlers} />
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
