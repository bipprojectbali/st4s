import { Badge, Button, Group, Paper, Select, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { STT_MODEL_ALIASES, STT_MODEL_ID } from '@server/v1/aliases';
import { useState } from 'react';
import { FiMic, FiSend, FiSquare } from 'react-icons/fi';
import type { TurnDetectionMode } from '~/lib/realtime-protocol';
import type { RealtimeState, RealtimeTurn, TurnStatus } from '~/lib/realtime-state';
import { useRealtimeTranscription } from './useRealtimeTranscription';

const MODELS = [STT_MODEL_ID, ...STT_MODEL_ALIASES];
const TURN_MODES = [
  { value: 'vad', label: 'Otomatis (VAD)' },
  { value: 'manual', label: 'Manual' },
];
const TURN_LABEL: Record<TurnStatus, { label: string; color: string }> = {
  speaking: { label: 'Berbicara…', color: 'red' },
  waiting: { label: 'Menunggu transkrip…', color: 'yellow' },
  transcribing: { label: 'Mentranskripsi…', color: 'blue' },
  done: { label: 'Selesai', color: 'teal' },
  failed: { label: 'Gagal', color: 'red' },
};

function connectionBadge(s: RealtimeState): { label: string; color: string } {
  if (s.connection === 'connecting') return { label: 'Menghubungkan…', color: 'yellow' };
  if (s.connection === 'lost') return { label: 'Terputus', color: 'red' };
  if (s.connection === 'idle') return { label: 'Tidak terhubung', color: 'gray' };
  return s.sessionReady
    ? { label: 'Terhubung', color: 'teal' }
    : { label: 'Menyiapkan sesi…', color: 'blue' };
}

function TurnRow({ turn, n }: { turn: RealtimeTurn; n: number }) {
  const meta = TURN_LABEL[turn.status];
  return (
    <Paper withBorder radius="sm" p="sm">
      <Stack gap={4}>
        <Group gap="xs" wrap="wrap">
          <Text size="xs" c="dimmed">
            Giliran {n}
          </Text>
          <Badge size="xs" variant="light" color={meta.color}>
            {meta.label}
          </Badge>
        </Group>
        {turn.error ? (
          <Text size="sm" c="red">
            {turn.error}
          </Text>
        ) : (
          <Text
            size="sm"
            c={turn.text ? undefined : 'dimmed'}
            style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
          >
            {turn.text || '…'}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

/** Live mic transcription over the OpenAI-compatible /api/v1/realtime WebSocket. */
export function RealtimePanel({
  languages,
  defaultLanguage,
  sttRegistered,
}: {
  languages: string[];
  defaultLanguage: string;
  sttRegistered: boolean;
}) {
  const { state, start, stop, commit, committing } = useRealtimeTranscription();
  const [model, setModel] = useState<string>(STT_MODEL_ID);
  const [language, setLanguage] = useState(defaultLanguage);
  const [mode, setMode] = useState<TurnDetectionMode>('vad');
  const active = state.connection === 'connecting' || state.connection === 'open';
  const badge = connectionBadge(state);
  const commitHint =
    mode === 'vad'
      ? 'Mode VAD memotong giliran otomatis.'
      : state.connection !== 'open'
        ? 'Mulai realtime dulu.'
        : 'Kirim audio sejak giliran terakhir untuk ditranskripsi.';

  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" wrap="wrap" gap="xs">
          <Title order={5}>Realtime (WebSocket)</Title>
          <Group gap="xs" wrap="wrap">
            <Badge variant="light" color={badge.color}>
              {badge.label}
            </Badge>
            {mode === 'vad' && state.connection === 'open' && (
              <Badge
                variant={state.speaking ? 'filled' : 'light'}
                color={state.speaking ? 'red' : 'gray'}
              >
                {state.speaking ? 'Suara terdeteksi' : 'Hening'}
              </Badge>
            )}
          </Group>
        </Group>
        <Text size="sm" c="dimmed">
          Audio mikrofon dikirim tiap ~100 ms sebagai PCM16 24 kHz ke /api/v1/realtime; transkrip
          muncul per giliran.
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
          <Select
            label="Model"
            data={MODELS}
            value={model}
            onChange={(v) => setModel(v ?? STT_MODEL_ID)}
            allowDeselect={false}
            disabled={active}
          />
          <Select
            label="Bahasa"
            data={languages}
            value={language}
            onChange={(v) => setLanguage(v ?? defaultLanguage)}
            allowDeselect={false}
            searchable
            disabled={active}
          />
          <Select
            label="Deteksi giliran"
            data={TURN_MODES}
            value={mode}
            onChange={(v) => setMode(v === 'manual' ? 'manual' : 'vad')}
            allowDeselect={false}
            disabled={active}
            description={active ? 'Hentikan sesi untuk mengubah' : undefined}
          />
        </SimpleGrid>
        <Group gap="xs" wrap="wrap">
          {active ? (
            <Button size="sm" color="red" leftSection={<FiSquare size={14} />} onClick={stop}>
              Hentikan
            </Button>
          ) : (
            <Button
              size="sm"
              leftSection={<FiMic size={14} />}
              onClick={() => start({ model, language, turnDetection: mode })}
              disabled={!sttRegistered}
            >
              Mulai realtime
            </Button>
          )}
          <Button
            size="sm"
            variant="default"
            leftSection={<FiSend size={14} />}
            onClick={commit}
            loading={committing}
            disabled={mode === 'vad' || state.connection !== 'open'}
          >
            Kirim giliran
          </Button>
          <Text size="xs" c="dimmed">
            {sttRegistered ? commitHint : 'Engine STT tidak terdaftar di proses ini.'}
          </Text>
        </Group>
        {state.turns.length ? (
          <Stack gap="xs">
            {state.turns.map((t, i) => (
              <TurnRow key={t.itemId} turn={t} n={i + 1} />
            ))}
          </Stack>
        ) : (
          <Paper withBorder radius="sm" p="sm" bg="var(--mantine-color-default-hover)">
            <Text size="sm" c="dimmed">
              Belum ada transkrip. {active ? 'Mulai bicara.' : 'Klik "Mulai realtime" lalu bicara.'}
            </Text>
          </Paper>
        )}
      </Stack>
    </Paper>
  );
}
