import { Button, Group, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { engineOverview } from '@server/api/engines';
import { requireRole } from '@server/guard';
import { loadGuardConfig } from '@server/memory-guard/config';
import { ROLES } from '@server/permissions';
import { useQuery } from '@tanstack/react-query';
import { FiActivity, FiCpu, FiHardDrive, FiMic, FiRefreshCw } from 'react-icons/fi';
import { Link } from 'react-router';
import { EngineCard } from '~/components/engines/EngineCard';
import { MemoryGuardAlert } from '~/components/engines/MemoryGuardAlert';
import { useEngineActions } from '~/components/engines/useEngineActions';
import { StatTile } from '~/components/logs/StatTile';
import { depsFor, type EngineOverview, fetchEngines, formatBytes } from '~/lib/engines-api';
import { toJson } from '~/lib/loader-json';
import { useTimeFormat } from '~/lib/time-format';
import type { Route } from './+types/engines';

const REFRESH_MS = 3000;

export function meta() {
  return [{ title: 'Engines — Makuro Dev' }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireRole(request, ROLES.SUPER_ADMIN);
  const { warnPct, criticalPct, emergencyPct, recoverPct, recoverSec } = loadGuardConfig();
  return {
    overview: toJson<EngineOverview>(engineOverview()),
    loadedAt: Date.now(),
    thresholds: { warnPct, criticalPct, emergencyPct, recoverPct, recoverSec },
  };
}

export default function EnginesPage({ loaderData }: Route.ComponentProps) {
  const { dateTime } = useTimeFormat();
  const actions = useEngineActions();
  const q = useQuery({
    queryKey: ['engines'],
    queryFn: fetchEngines,
    initialData: loaderData.overview,
    initialDataUpdatedAt: loaderData.loadedAt,
    refetchInterval: REFRESH_MS,
  });
  const d = q.data;
  const mem = d.memory;

  return (
    <Stack gap="md" p={{ base: 'sm', md: 'md' }}>
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Title order={3}>Engines</Title>
          <Text size="sm" c="dimmed">
            Model STT dan TTS di proses ini. Diperbarui otomatis tiap {REFRESH_MS / 1000} detik ·
            terakhir {dateTime(d.generatedAt)}.
          </Text>
        </div>
        <Group gap="xs" wrap="wrap" justify="flex-end">
          <Button
            size="sm"
            variant="default"
            component={Link}
            to="/dev/playground"
            leftSection={<FiMic size={14} />}
          >
            Buka Playground
          </Button>
          <Button
            size="sm"
            variant="light"
            leftSection={<FiRefreshCw size={14} />}
            loading={q.isFetching}
            onClick={() => q.refetch()}
          >
            Muat ulang
          </Button>
        </Group>
      </Group>
      {q.isError && (
        <Text size="sm" c="red">
          Gagal memperbarui status: {q.error.message}. Menampilkan data terakhir.
        </Text>
      )}
      <MemoryGuardAlert
        guard={d.memoryGuard}
        thresholds={loaderData.thresholds}
        now={q.dataUpdatedAt}
        dateTime={dateTime}
      />

      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
        <StatTile label="RSS server" value={formatBytes(mem.serverRssBytes)} icon={FiCpu} />
        <StatTile
          label="RAM bebas"
          value={formatBytes(mem.freeBytes)}
          hint={`dari ${formatBytes(mem.totalBytes)}`}
          icon={FiHardDrive}
          color="teal"
        />
        <StatTile
          label="RSS engine"
          value={formatBytes((d.stt?.rssBytes ?? 0) + (d.tts?.rssBytes ?? 0) || null)}
          hint="Total proses child STT + TTS"
          icon={FiActivity}
          color="grape"
        />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        <EngineCard kind="stt" status={d.stt} deps={depsFor('stt', d.deps)} actions={actions} />
        <EngineCard kind="tts" status={d.tts} deps={depsFor('tts', d.deps)} actions={actions} />
      </SimpleGrid>
      <Text size="xs" c="dimmed">
        Bahasa default: STT {d.stt_default_language} · TTS {d.tts_default_language} ·{' '}
        {d.tts_voices.length} suara TTS.
      </Text>
    </Stack>
  );
}
