import {
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { FiAlertTriangle, FiPower, FiZap } from 'react-icons/fi';
import {
  type EngineDep,
  type EngineKind,
  type EngineStatus,
  formatBytes,
  formatMs,
  STATE_META,
} from '~/lib/engines-api';
import { useTimeFormat } from '~/lib/time-format';
import type { useEngineActions } from './useEngineActions';

const TITLE: Record<EngineKind, string> = { stt: 'Speech-to-text', tts: 'Text-to-speech' };

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text size="sm" fw={500} style={{ overflowWrap: 'anywhere' }}>
        {value}
      </Text>
    </div>
  );
}

/** Files/binaries the engine needs, each with an ok/missing badge. */
function DepList({ deps }: { deps: EngineDep[] }) {
  if (!deps.length) return null;
  return (
    <Stack gap={6}>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        Dependensi
      </Text>
      {deps.map((d) => (
        <Group key={d.name} justify="space-between" wrap="nowrap" gap="xs">
          <div style={{ minWidth: 0, flex: 1 }}>
            <Text size="sm" ff="monospace" truncate>
              {d.name}
            </Text>
            <Text size="xs" c="dimmed" truncate title={d.detail}>
              {d.detail}
            </Text>
          </div>
          <Badge variant="light" color={d.ok ? 'teal' : 'red'} style={{ flexShrink: 0 }}>
            {d.ok ? 'Ada' : 'Tidak ada'}
          </Badge>
        </Group>
      ))}
    </Stack>
  );
}

/** Disabled reason for a button, or null when it can be used. */
function blockReason(s: EngineStatus, action: 'warmup' | 'unload', busy: boolean): string | null {
  if (busy) return 'Aksi engine lain sedang berjalan.';
  if (s.state === 'loading') return 'Model sedang dimuat.';
  if (action === 'warmup' && (s.state === 'ready' || s.state === 'busy'))
    return 'Model sudah ada di memori.';
  if (action === 'unload' && s.state === 'unloaded')
    return 'Model belum dimuat — tidak ada yang dilepas.';
  return null;
}

/** One engine: state, model, queue, latency and memory, plus warmup/unload. */
export function EngineCard({
  kind,
  status: s,
  deps,
  actions,
}: {
  kind: EngineKind;
  status: EngineStatus | null;
  deps: EngineDep[];
  actions: ReturnType<typeof useEngineActions>;
}) {
  const { dateTime } = useTimeFormat();
  if (!s)
    return (
      <Paper withBorder radius="md" p="md">
        <Title order={5}>{TITLE[kind]}</Title>
        <Text size="sm" c="dimmed" mt="xs">
          Engine {kind.toUpperCase()} tidak terdaftar di proses server ini. Cek konfigurasi engine
          lalu restart server.
        </Text>
        <Divider my="sm" />
        <DepList deps={deps} />
      </Paper>
    );
  const meta = STATE_META[s.state];
  const button = (action: 'warmup' | 'unload') => {
    const reason = blockReason(s, action, actions.busy && !actions.pending(kind, action));
    const btn = (
      <Button
        size="sm"
        variant="light"
        color={action === 'unload' ? 'orange' : 'teal'}
        leftSection={action === 'unload' ? <FiPower size={14} /> : <FiZap size={14} />}
        loading={actions.pending(kind, action)}
        disabled={Boolean(reason)}
        onClick={() => actions.confirm(kind, action)}
      >
        {action === 'unload' ? 'Unload' : 'Warmup'}
      </Button>
    );
    return reason ? (
      <Tooltip label={reason} key={action}>
        <span>{btn}</span>
      </Tooltip>
    ) : (
      <span key={action}>{btn}</span>
    );
  };

  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" wrap="wrap" gap="xs">
          <div style={{ minWidth: 0 }}>
            <Group gap="xs">
              <Title order={5}>{TITLE[kind]}</Title>
              <Badge variant="light" color={meta.color}>
                {meta.label}
              </Badge>
            </Group>
            <Text size="sm" c="dimmed" truncate>
              {s.model}
            </Text>
          </div>
          <Group gap="xs" wrap="wrap">
            {button('warmup')}
            {button('unload')}
          </Group>
        </Group>
        {s.lastError && (
          <Alert color="red" variant="light" icon={<FiAlertTriangle size={16} />} p="xs">
            <Text size="sm" style={{ wordBreak: 'break-word' }}>
              {s.lastError}
            </Text>
          </Alert>
        )}
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
          <Field label="Antrean" value={String(s.queued)} />
          <Field label="Dimuat" value={s.loadedAt ? dateTime(s.loadedAt) : '—'} />
          <Field label="RSS child" value={formatBytes(s.rssBytes)} />
          <Field label="Request / error" value={`${s.stats.requests} / ${s.stats.errors}`} />
          <Field label="p50" value={formatMs(s.stats.p50Ms)} />
          <Field label="p95" value={formatMs(s.stats.p95Ms)} />
          <Field
            label="RTF p50"
            value={
              s.stats.rtfP50 == null
                ? '—'
                : s.stats.rtfP50.toLocaleString('id-ID', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })
            }
          />
        </SimpleGrid>
        <Divider />
        <DepList deps={deps} />
      </Stack>
    </Paper>
  );
}
