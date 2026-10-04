/** Browser-session calls to /api/v1/audio/* for /dev/playground. */
import { TTS_MODEL_ID } from '@server/v1/aliases';
import { apiErrorMessage } from './engines-api';
import { base64ToBytes } from './pcm-player';
import { readSse, sseErrorMessage } from './playground-sse';

const V1 = '/api/v1/audio';

export type SttRequest = { file: Blob; filename: string; language: string; keywords: string };
export type SpeechRequest = {
  input: string;
  voice: string;
  speed: number;
  steps: number;
  language: string;
};

const NETWORK_ERROR = 'Koneksi ke server terputus. Pastikan server berjalan lalu coba lagi.';

/** Browser network failures surface as TypeError ("Failed to fetch") — rethrow with a readable message. */
async function net<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof TypeError) throw new Error(NETWORK_ERROR, { cause: e });
    throw e;
  }
}

async function ensureOk(res: Response, fallback: string): Promise<Response> {
  if (!res.ok) throw new Error(await apiErrorMessage(res, fallback));
  return res;
}

/** Streamed transcription: `onDelta` per text delta, resolves with the final text. */
export async function streamTranscription(
  req: SttRequest,
  onDelta: (delta: string) => void,
  signal: AbortSignal,
): Promise<{ text: string; seconds: number | null }> {
  const form = new FormData();
  form.append('file', req.file, req.filename);
  form.append('model', 'whisper-1');
  form.append('stream', 'true');
  if (req.language) form.append('language', req.language);
  if (req.keywords.trim()) form.append('keywords', req.keywords.trim());
  const res = await ensureOk(
    await net(fetch(`${V1}/transcriptions`, { method: 'POST', body: form, signal })),
    'Transkripsi gagal',
  );
  const done: { text: string | null; seconds: number | null } = { text: null, seconds: null };
  await net(
    readSse(res, (e) => {
      const msg = sseErrorMessage(e);
      if (msg) throw new Error(msg);
      const ev = e as {
        type?: string;
        delta?: string;
        text?: string;
        usage?: { seconds?: number };
      };
      if (ev.type === 'transcript.text.delta' && ev.delta) onDelta(ev.delta);
      if (ev.type === 'transcript.text.done') {
        done.text = ev.text ?? '';
        done.seconds = ev.usage?.seconds ?? null;
      }
    }),
  );
  if (done.text === null)
    throw new Error('Stream transkripsi berakhir tanpa hasil akhir. Coba lagi.');
  return { text: done.text, seconds: done.seconds };
}

const speechBody = (r: SpeechRequest, extra: Record<string, unknown>) =>
  JSON.stringify({
    model: TTS_MODEL_ID,
    input: r.input,
    voice: r.voice,
    speed: r.speed,
    steps: r.steps,
    language: r.language,
    ...extra,
  });

/** Streamed speech as base64 PCM16 24 kHz chunks, decoded and handed to `onChunk`. */
export async function streamSpeech(
  req: SpeechRequest,
  onChunk: (pcm: Uint8Array) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await ensureOk(
    await net(
      fetch(`${V1}/speech`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: speechBody(req, { response_format: 'pcm', stream_format: 'sse' }),
        signal,
      }),
    ),
    'Sintesis suara gagal',
  );
  await net(
    readSse(res, (e) => {
      const msg = sseErrorMessage(e);
      if (msg) throw new Error(msg);
      const ev = e as { type?: string; audio?: string };
      if (ev.type === 'speech.audio.delta' && ev.audio) onChunk(base64ToBytes(ev.audio));
    }),
  );
}

/** Non-streamed WAV of the same request, for download. */
export async function fetchSpeechWav(req: SpeechRequest, signal: AbortSignal): Promise<Blob> {
  const res = await ensureOk(
    await net(
      fetch(`${V1}/speech`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: speechBody(req, { response_format: 'wav' }),
        signal,
      }),
    ),
    'Gagal membuat WAV',
  );
  return net(res.blob());
}

/** Trigger a browser download of `blob`. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** True for an abort triggered by the Stop button (not a real failure). */
export const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';
