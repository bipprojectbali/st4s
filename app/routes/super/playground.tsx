import { Alert, Button, Group, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { engineOverview } from '@server/api/engines';
import { requireRole } from '@server/guard';
import { ROLES } from '@server/permissions';
import { NATIVE_VOICES } from '@server/v1/aliases';
import { FiCpu, FiInfo } from 'react-icons/fi';
import { Link } from 'react-router';
import { RealtimePanel } from '~/components/playground/RealtimePanel';
import { SttPanel } from '~/components/playground/SttPanel';
import { TtsPanel } from '~/components/playground/TtsPanel';
import type { Route } from './+types/playground';

export function meta() {
  return [{ title: 'Playground — st4s' }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireRole(request, ROLES.SUPER_ADMIN);
  const o = engineOverview();
  return {
    sttRegistered: o.stt !== null,
    ttsRegistered: o.tts !== null,
    voices: o.tts_voices.length ? o.tts_voices : [...NATIVE_VOICES],
    languages: o.tts_languages,
    sttDefaultLanguage: o.stt_default_language,
    ttsDefaultLanguage: o.tts_default_language,
  };
}

export default function PlaygroundPage({ loaderData: d }: Route.ComponentProps) {
  const missing = [!d.sttRegistered && 'STT', !d.ttsRegistered && 'TTS'].filter(Boolean);
  const sttLanguages = d.languages.includes(d.sttDefaultLanguage)
    ? d.languages
    : [d.sttDefaultLanguage, ...d.languages];
  return (
    <Stack gap="md" p={{ base: 'sm', md: 'md' }}>
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Title order={3}>Playground</Title>
          <Text size="sm" c="dimmed">
            Coba endpoint /api/v1/audio dan /api/v1/realtime dengan sesi browser ini. Request
            pertama menunggu model dimuat bila engine belum di-warmup.
          </Text>
        </div>
        <Button
          size="sm"
          variant="default"
          component={Link}
          to="/dev/engines"
          leftSection={<FiCpu size={14} />}
        >
          Status engine
        </Button>
      </Group>
      {missing.length > 0 && (
        <Alert color="orange" variant="light" icon={<FiInfo size={16} />}>
          Engine {missing.join(' dan ')} tidak terdaftar di proses ini — request ke sana akan gagal
          dengan 503.
        </Alert>
      )}
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        <SttPanel languages={sttLanguages} defaultLanguage={d.sttDefaultLanguage} />
        <TtsPanel
          voices={d.voices}
          languages={d.languages}
          defaultLanguage={d.ttsDefaultLanguage}
        />
      </SimpleGrid>
      <RealtimePanel
        languages={sttLanguages}
        defaultLanguage={d.sttDefaultLanguage}
        sttRegistered={d.sttRegistered}
      />
    </Stack>
  );
}
