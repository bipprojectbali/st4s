import {
  Badge,
  Button,
  Chip,
  Group,
  Paper,
  Select,
  Slider,
  Stack,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { VOICE_ALIASES } from '@server/v1/aliases';
import { useEffect, useRef, useState } from 'react';
import { FiDownload, FiPlay, FiSquare } from 'react-icons/fi';
import { formatMs } from '~/lib/engines-api';
import { createPcmPlayer, PCM_RATE, type PcmPlayer } from '~/lib/pcm-player';
import {
  fetchSpeechWav,
  isAbort,
  type SpeechRequest,
  saveBlob,
  streamSpeech,
} from '~/lib/playground-api';

const MAX_CHARS = 4096;
const SAMPLE = 'Halo! Ini contoh suara dari Supertonic yang diputar langsung saat data tiba.';

type Stats = { ttfaMs: number | null; totalMs: number | null; audioSec: number };

/** Text → streamed PCM played progressively via WebAudio, plus a WAV download. */
export function TtsPanel(props: {
  voices: string[];
  languages: string[];
  defaultLanguage: string;
}) {
  const [input, setInput] = useState(SAMPLE);
  const [voice, setVoice] = useState(props.voices[0] ?? 'F1');
  const [language, setLanguage] = useState(props.defaultLanguage);
  const [speed, setSpeed] = useState(1);
  const [steps, setSteps] = useState(8);
  const [busy, setBusy] = useState<'play' | 'wav' | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const abort = useRef<AbortController | null>(null);
  const player = useRef<PcmPlayer | null>(null);
  const fail = (title: string, e: unknown) =>
    notifications.show({ color: 'red', title, message: (e as Error).message });

  const stop = () => {
    abort.current?.abort();
    player.current?.stop();
    player.current = null;
  };
  useEffect(
    () => () => {
      abort.current?.abort();
      player.current?.stop();
    },
    [],
  );

  const req = (): SpeechRequest => ({ input, voice, speed, steps, language });

  const play = async () => {
    stop();
    const ctrl = new AbortController();
    abort.current = ctrl;
    const p = createPcmPlayer();
    player.current = p;
    setBusy('play');
    const t0 = performance.now();
    const s: Stats = { ttfaMs: null, totalMs: null, audioSec: 0 };
    setStats({ ...s });
    try {
      await streamSpeech(
        req(),
        (pcm) => {
          if (s.ttfaMs == null) s.ttfaMs = performance.now() - t0;
          s.audioSec += pcm.length / 2 / PCM_RATE;
          p.push(pcm);
          setStats({ ...s });
        },
        ctrl.signal,
      );
      s.totalMs = performance.now() - t0;
      setStats({ ...s });
      await p.drained();
    } catch (e) {
      if (!isAbort(e)) fail('Sintesis suara gagal', e);
    } finally {
      if (player.current === p) {
        p.stop();
        player.current = null;
        setBusy(null);
      }
    }
  };

  const downloadWav = async () => {
    stop();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy('wav');
    try {
      saveBlob(await fetchSpeechWav(req(), ctrl.signal), `speech-${voice}.wav`);
      notifications.show({ color: 'teal', message: 'WAV diunduh.' });
    } catch (e) {
      if (!isAbort(e)) fail('Gagal membuat WAV', e);
    } finally {
      setBusy(null);
    }
  };

  const empty = !input.trim();
  const aliases = Object.entries(VOICE_ALIASES);
  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="sm">
        <Title order={5}>Text-to-speech</Title>
        <Textarea
          label="Teks"
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          maxLength={MAX_CHARS}
          autosize
          minRows={3}
          maxRows={10}
          description={`${input.length}/${MAX_CHARS} karakter`}
        />
        <div>
          <Text size="sm" fw={500} mb={4}>
            Suara
          </Text>
          <Chip.Group value={voice} onChange={(v) => setVoice(v as string)}>
            <Group gap={6} wrap="wrap">
              {props.voices.map((v) => (
                <Chip key={v} value={v} size="sm">
                  {v}
                </Chip>
              ))}
            </Group>
            <Text size="xs" c="dimmed" mt="xs" mb={4}>
              Alias OpenAI
            </Text>
            <Group gap={6} wrap="wrap">
              {aliases.map(([alias, native]) => (
                <Chip
                  key={alias}
                  value={alias}
                  size="xs"
                  variant="outline"
                >{`${alias} → ${native}`}</Chip>
              ))}
            </Group>
          </Chip.Group>
        </div>
        <Group grow wrap="wrap" align="flex-start">
          <Select
            label="Bahasa"
            data={props.languages}
            value={language}
            onChange={(v) => setLanguage(v ?? props.defaultLanguage)}
            allowDeselect={false}
            searchable
            miw={140}
          />
          <div style={{ minWidth: 160 }}>
            <Text size="sm" fw={500}>
              Kecepatan {speed.toFixed(2)}×
            </Text>
            <Slider
              min={0.25}
              max={4}
              step={0.05}
              value={speed}
              onChange={setSpeed}
              label={(v) => `${v.toFixed(2)}×`}
              mt={6}
            />
          </div>
          <div style={{ minWidth: 160 }}>
            <Text size="sm" fw={500}>
              Steps {steps}
            </Text>
            <Slider min={1} max={20} step={1} value={steps} onChange={setSteps} mt={6} />
          </div>
        </Group>
        <Group gap="xs" wrap="wrap">
          <Button
            size="sm"
            leftSection={<FiPlay size={14} />}
            onClick={play}
            loading={busy === 'play'}
            disabled={empty || busy === 'wav'}
          >
            Putar (streaming)
          </Button>
          <Button
            size="sm"
            variant="default"
            leftSection={<FiDownload size={14} />}
            onClick={downloadWav}
            loading={busy === 'wav'}
            disabled={empty || busy === 'play'}
          >
            Unduh WAV
          </Button>
          {busy && (
            <Button
              size="sm"
              variant="light"
              color="red"
              leftSection={<FiSquare size={14} />}
              onClick={() => {
                stop();
                setBusy(null);
              }}
            >
              Stop
            </Button>
          )}
        </Group>
        {empty && (
          <Text size="xs" c="dimmed">
            Isi teks dulu untuk memutar atau mengunduh.
          </Text>
        )}
        {stats && (
          <Group gap="xs" wrap="wrap">
            <Badge variant="light" color="teal">
              Audio pertama {formatMs(stats.ttfaMs)}
            </Badge>
            <Badge variant="light">Audio {stats.audioSec.toFixed(1)} dtk</Badge>
            <Badge variant="light" color="grape">
              Stream selesai {formatMs(stats.totalMs)}
            </Badge>
          </Group>
        )}
      </Stack>
    </Paper>
  );
}
