import {
  Alert,
  Button,
  Chip,
  CloseButton,
  Code,
  Group,
  Paper,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from '@mantine/core';
import { changelogOverview } from '@server/changelog';
import { countItems, filterReleases } from '@server/changelog-parse';
import { requireRole } from '@server/guard';
import { ROLES } from '@server/permissions';
import { useMemo, useState } from 'react';
import { FiAlertTriangle, FiBookOpen, FiClock, FiLayers, FiSearch, FiTag } from 'react-icons/fi';
import {
  ChangelogTimeline,
  formatReleaseDate,
  SECTION_META,
  sectionMeta,
} from '~/components/changelog/ChangelogTimeline';
import { StatTileGrid } from '~/components/logs/StatTile';
import type { Route } from './+types/changelog';

export function meta() {
  return [{ title: 'Changelog — st4s' }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireRole(request, ROLES.SUPER_ADMIN);
  return changelogOverview();
}

const EXAMPLE = `## [Unreleased]

### Added
- Fitur baru dari sudut pandang user.

## [0.1.0] - 2026-09-14

### Fixed
- Perbaikan yang dirasakan user.`;

function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Paper withBorder radius="md" p="xl">
      <Stack align="center" gap="xs" ta="center">
        <ThemeIcon variant="light" color="gray" size={48} radius="xl">
          <FiBookOpen size={22} />
        </ThemeIcon>
        <Text fw={600}>{title}</Text>
        {children}
      </Stack>
    </Paper>
  );
}

export default function ChangelogPage({ loaderData: cl }: Route.ComponentProps) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState<string | null>(null);
  const types = useMemo(() => {
    const seen = new Set(cl.releases.flatMap((r) => r.sections.map((s) => s.type)));
    const known = Object.keys(SECTION_META).filter((t) => seen.has(t));
    return [...known, ...[...seen].filter((t) => !known.includes(t))];
  }, [cl.releases]);
  const shown = useMemo(() => filterReleases(cl.releases, type, query), [cl.releases, type, query]);
  const shownCount = shown.reduce((n, r) => n + countItems(r), 0);
  const released = cl.releases.filter((r) => !r.unreleased);
  const latest = released[0];
  const filtering = Boolean(type || query.trim());

  return (
    <Stack gap="md" p={{ base: 'sm', md: 'md' }}>
      <div>
        <Title order={3}>Changelog</Title>
        <Text size="sm" c="dimmed">
          Riwayat perubahan dari <Code>CHANGELOG.md</Code>, ditulis dari sudut pandang user. Agent
          mencatat perubahan di bagian <Code>Unreleased</Code> lalu memberinya nomor versi saat
          deploy.
        </Text>
      </div>

      {!cl.available ? (
        <EmptyState title="CHANGELOG.md belum ada">
          <Text size="sm" c="dimmed" maw={520}>
            Buat file <Code>CHANGELOG.md</Code> di root project dengan format Keep a Changelog.
            Halaman ini akan membacanya otomatis.
          </Text>
          <Code block ta="left" w="100%" maw={520}>
            {EXAMPLE}
          </Code>
        </EmptyState>
      ) : (
        <>
          {!cl.currentHasEntry && (
            <Alert
              color="yellow"
              variant="light"
              icon={<FiAlertTriangle size={16} />}
              title={`Versi berjalan v${cl.currentVersion} belum punya entry`}
            >
              Sebelum deploy, ganti <Code>## [Unreleased]</Code> menjadi{' '}
              <Code>{`## [${cl.currentVersion}] - YYYY-MM-DD`}</Code> atau naikkan versi di{' '}
              <Code>package.json</Code>.
            </Alert>
          )}

          <StatTileGrid
            tiles={[
              {
                label: 'Versi berjalan',
                value: `v${cl.currentVersion}`,
                hint: cl.currentHasEntry ? 'Tercatat di changelog' : 'Belum tercatat',
                icon: FiTag,
                color: cl.currentHasEntry ? 'grape' : 'yellow',
              },
              {
                label: 'Rilis',
                value: String(released.length),
                hint: latest?.date
                  ? `Terakhir ${formatReleaseDate(latest.date)}`
                  : 'Belum ada rilis',
                icon: FiLayers,
                color: 'blue',
              },
              {
                label: 'Belum dirilis',
                value: String(cl.unreleasedCount),
                hint: cl.unreleasedCount ? 'Menunggu nomor versi' : 'Semua sudah dirilis',
                icon: FiClock,
                color: cl.unreleasedCount ? 'yellow' : 'gray',
              },
            ]}
          />

          <Group gap="sm" wrap="wrap" align="center">
            <TextInput
              placeholder="Cari perubahan…"
              aria-label="Cari perubahan"
              leftSection={<FiSearch size={14} />}
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              rightSection={
                query && (
                  <CloseButton
                    size="sm"
                    aria-label="Hapus pencarian"
                    onClick={() => setQuery('')}
                  />
                )
              }
              w={{ base: '100%', sm: 280 }}
            />
            <Chip.Group value={type ?? 'all'} onChange={(v) => setType(v === 'all' ? null : v)}>
              <Group gap={6} wrap="wrap">
                <Chip value="all" size="sm">
                  Semua
                </Chip>
                {types.map((t) => (
                  <Chip key={t} value={t} size="sm" color={sectionMeta(t).color}>
                    {sectionMeta(t).label}
                  </Chip>
                ))}
              </Group>
            </Chip.Group>
          </Group>

          {filtering && (
            <Text size="xs" c="dimmed">
              Menampilkan {shownCount} perubahan di {shown.length} versi
            </Text>
          )}

          {cl.releases.length === 0 ? (
            <EmptyState title="Belum ada entry">
              <Text size="sm" c="dimmed" maw={520}>
                <Code>CHANGELOG.md</Code> ada tetapi belum berisi versi. Tambahkan bagian{' '}
                <Code>## [Unreleased]</Code> berisi daftar perubahan.
              </Text>
            </EmptyState>
          ) : shown.length === 0 ? (
            <EmptyState title="Tidak ada perubahan yang cocok">
              <Button
                size="sm"
                variant="light"
                onClick={() => {
                  setQuery('');
                  setType(null);
                }}
              >
                Reset filter
              </Button>
            </EmptyState>
          ) : (
            <Paper withBorder radius="md" p={{ base: 'sm', md: 'lg' }}>
              <ChangelogTimeline
                releases={shown}
                currentVersion={cl.currentVersion}
                query={query}
              />
            </Paper>
          )}
        </>
      )}
    </Stack>
  );
}
