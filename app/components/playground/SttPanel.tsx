import {
  Badge,
  Button,
  FileButton,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useEffect, useRef, useState } from 'react';
import { FiMic, FiSquare, FiUpload, FiX } from 'react-icons/fi';
import { formatBytes, formatMs } from '~/lib/engines-api';
import { isAbort, streamTranscription } from '~/lib/playground-api';
import { extFor, useRecorder } from './useRecorder';

type Audio = { blob: Blob; name: string };
type Result = { seconds: number | null; latencyMs: number; firstDeltaMs: number | null };

function RecordTimer({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  return (
    <Text size="sm" c="red">
      {Math.floor((now - since) / 1000)} dtk
    </Text>
  );
}

/** Record or upload audio and stream it through /api/v1/audio/transcriptions. */
export function SttPanel({
  languages,
  defaultLanguage,
}: {
  languages: string[];
  defaultLanguage: string;
}) {
  const recorder = useRecorder();
  const [audio, setAudio] = useState<Audio | null>(null);
  const [language, setLanguage] = useState(defaultLanguage);
  const [keywords, setKeywords] = useState('');
  const [text, setText] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [running, setRunning] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const resetFile = useRef<() => void>(null);
  const fail = (title: string, e: unknown) =>
    notifications.show({ color: 'red', title, message: (e as Error).message });

  const toggleRecord = async () => {
    try {
      if (!recorder.recording) return await recorder.start();
      const blob = await recorder.stop();
      setAudio({ blob, name: `rekaman.${extFor(blob.type)}` });
    } catch (e) {
      fail('Perekaman gagal', e);
    }
  };

  const run = async () => {
    if (!audio) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setRunning(true);
    setText('');
    setResult(null);
    const t0 = performance.now();
    let firstDeltaMs: number | null = null;
    try {
      const r = await streamTranscription(
        { file: audio.blob, filename: audio.name, language, keywords },
        (delta) => {
          firstDeltaMs ??= performance.now() - t0;
          setText((t) => t + delta);
        },
        ctrl.signal,
      );
      setText(r.text);
      setResult({ seconds: r.seconds, latencyMs: performance.now() - t0, firstDeltaMs });
    } catch (e) {
      if (!isAbort(e)) fail('Transkripsi gagal', e);
    } finally {
      setRunning(false);
      abort.current = null;
    }
  };

  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="sm">
        <Title order={5}>Speech-to-text</Title>
        <Group gap="xs" wrap="wrap">
          <Button
            size="sm"
            color={recorder.recording ? 'red' : 'blue'}
            variant={recorder.recording ? 'filled' : 'light'}
            leftSection={recorder.recording ? <FiSquare size={14} /> : <FiMic size={14} />}
            onClick={toggleRecord}
            disabled={running}
          >
            {recorder.recording ? 'Berhenti merekam' : 'Rekam'}
          </Button>
          <FileButton
            onChange={(f) => {
              if (f) setAudio({ blob: f, name: f.name });
              // The input keeps its value; clear it so picking the same file again fires onChange.
              resetFile.current?.();
            }}
            resetRef={resetFile}
            accept="audio/*,video/*"
          >
            {(props) => (
              <Button
                {...props}
                size="sm"
                variant="default"
                leftSection={<FiUpload size={14} />}
                disabled={running || recorder.recording}
              >
                Unggah file
              </Button>
            )}
          </FileButton>
          {recorder.startedAt && <RecordTimer since={recorder.startedAt} />}
        </Group>
        {audio ? (
          <Group gap="xs" wrap="nowrap">
            <Text size="sm" truncate style={{ minWidth: 0, flex: 1 }}>
              {audio.name} · {formatBytes(audio.blob.size)}
            </Text>
            <Button
              size="compact-sm"
              variant="subtle"
              color="gray"
              leftSection={<FiX size={12} />}
              onClick={() => setAudio(null)}
              disabled={running}
            >
              Hapus
            </Button>
          </Group>
        ) : (
          <Text size="sm" c="dimmed">
            Belum ada audio. Rekam dari mikrofon atau unggah file.
          </Text>
        )}
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <Select
            label="Bahasa"
            data={languages}
            value={language}
            onChange={(v) => setLanguage(v ?? defaultLanguage)}
            allowDeselect={false}
            searchable
          />
          <TextInput
            label="Kata kunci (opsional)"
            placeholder="Makuro, Supertonic"
            description="Dipisah koma; membantu ejaan nama"
            value={keywords}
            onChange={(e) => setKeywords(e.currentTarget.value)}
          />
        </SimpleGrid>
        <Group gap="xs" wrap="wrap">
          <Button size="sm" onClick={run} loading={running} disabled={!audio || recorder.recording}>
            Transkripsikan
          </Button>
          {running && (
            <Button
              size="sm"
              variant="default"
              leftSection={<FiSquare size={14} />}
              onClick={() => abort.current?.abort()}
            >
              Stop
            </Button>
          )}
        </Group>
        <Paper withBorder radius="sm" p="sm" mih={80} bg="var(--mantine-color-default-hover)">
          <Text
            size="sm"
            style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
            c={text ? undefined : 'dimmed'}
          >
            {text || (running ? 'Menunggu teks pertama…' : 'Hasil transkripsi muncul di sini.')}
          </Text>
        </Paper>
        {result && (
          <Group gap="xs" wrap="wrap">
            <Badge variant="light">
              Audio {formatMs(result.seconds == null ? null : result.seconds * 1000)}
            </Badge>
            <Badge variant="light" color="teal">
              Teks pertama {formatMs(result.firstDeltaMs)}
            </Badge>
            <Badge variant="light" color="grape">
              Total {formatMs(result.latencyMs)}
            </Badge>
          </Group>
        )}
      </Stack>
    </Paper>
  );
}
