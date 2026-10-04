/** Playground client: browser network failures become a readable Indonesian message, aborts stay aborts. */
import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import {
  fetchSpeechWav,
  isAbort,
  streamSpeech,
  streamTranscription,
} from '../app/lib/playground-api';

const speech = { input: 'Halo', voice: 'F1', speed: 1, steps: 8, language: 'id' };
const stt = {
  file: new Blob([new Uint8Array(4)]),
  filename: 'a.wav',
  language: 'id',
  keywords: '',
};
const NETWORK = /Koneksi ke server terputus/;

let fetchSpy: ReturnType<typeof spyOn> | null = null;
const stubFetch = (impl: () => Promise<Response>) => {
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(impl as unknown as typeof fetch);
};
afterEach(() => fetchSpy?.mockRestore());

/** SSE response whose body emits one event, then fails like a dropped connection. */
function droppedStream(event: object): Response {
  let sent = false;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (sent) return c.error(new TypeError('network error'));
      sent = true;
      c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
    },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

describe('playground-api network errors', () => {
  test('fetch TypeError → Indonesian message with the original as cause', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    const err = await fetchSpeechWav(speech, new AbortController().signal).catch((e) => e);
    expect(err.message).toMatch(NETWORK);
    expect((err.cause as Error).message).toBe('Failed to fetch');
  });

  test('stream dropped mid-transcription → Indonesian message after the delta arrived', async () => {
    stubFetch(async () => droppedStream({ type: 'transcript.text.delta', delta: 'Ha' }));
    const deltas: string[] = [];
    const err = await streamTranscription(
      stt,
      (d) => deltas.push(d),
      new AbortController().signal,
    ).catch((e) => e);
    expect(deltas).toEqual(['Ha']);
    expect(err.message).toMatch(NETWORK);
  });

  test('server error event keeps its own message', async () => {
    stubFetch(async () => droppedStream({ error: { message: 'Engine sibuk.' } }));
    const err = await streamSpeech(speech, () => {}, new AbortController().signal).catch((e) => e);
    expect(err.message).toBe('Engine sibuk.');
  });

  test('abort is not rewritten, so Stop stays silent', async () => {
    stubFetch(() => Promise.reject(new DOMException('aborted', 'AbortError')));
    const err = await streamSpeech(speech, () => {}, new AbortController().signal).catch((e) => e);
    expect(isAbort(err)).toBe(true);
  });
});
