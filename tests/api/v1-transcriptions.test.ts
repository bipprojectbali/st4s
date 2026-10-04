/** /api/v1/audio/transcriptions through the official openai SDK (custom fetch -> app.handle) and raw requests. */
import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import OpenAI, { AuthenticationError, BadRequestError, NotFoundError, RateLimitError, toFile } from 'openai';
import { setEngines } from '../../server/engines/registry';
import { logger } from '../../server/logger';
import { appFetch, call, DELTAS, fakeStt, form, resetFake, SESSION_TOKEN, stubSession, TRANSCRIPT } from '../v1/fake-stt';
import { makeWav } from '../v1/wav-fixture';

const wav = makeWav({ sampleRate: 16_000, channels: 1, bits: 16, frames: 16_000 });
const client = (apiKey = SESSION_TOKEN) =>
  new OpenAI({ apiKey, baseURL: 'http://localhost/api/v1', fetch: appFetch, maxRetries: 0 });
const sdk = client();
const file = () => toFile(wav, 'a.wav', { type: 'audio/wav' });

let spies: { mockRestore(): void }[] = [];
beforeAll(() => {
  spies = stubSession();
  setEngines({ stt: fakeStt });
});
afterAll(() => {
  for (const s of spies) s.mockRestore();
  setEngines({ stt: null });
});
beforeEach(resetFake);

describe('openai SDK — audio.transcriptions.create', () => {
  test('json returns text + duration usage and forwards language/hotwords', async () => {
    const res = await sdk.audio.transcriptions.create({
      file: await file(),
      model: 'whisper-1',
      language: 'id',
      prompt: 'Qwen, Supertonic',
    });
    expect(res.text).toBe(TRANSCRIPT.text);
    expect((res as unknown as { usage: unknown }).usage).toEqual({ type: 'duration', seconds: 1 });
    expect(fakeStt.last?.language).toBe('id');
    expect(fakeStt.last?.hotwords).toEqual(['Qwen', 'Supertonic']);
    expect(fakeStt.last?.audio.length).toBe(16_000);
    expect(fakeStt.last?.wordTimestamps).toBe(false);
  });

  test('stream yields every delta, then done with the full text', async () => {
    const stream = await sdk.audio.transcriptions.create({ file: await file(), model: 'gpt-4o-transcribe', stream: true });
    const events: { type: string; delta?: string; text?: string }[] = [];
    for await (const ev of stream) events.push(ev as (typeof events)[number]);
    expect(events.filter((e) => e.type === 'transcript.text.delta').map((e) => e.delta)).toEqual(DELTAS);
    expect(events.at(-1)).toMatchObject({ type: 'transcript.text.done', text: TRANSCRIPT.text });
  });

  test('verbose_json carries segments and, with word granularity, words', async () => {
    const res = await sdk.audio.transcriptions.create({
      file: await file(),
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['word', 'segment'],
    });
    expect(fakeStt.last?.wordTimestamps).toBe(true);
    expect(res.language).toBe('id');
    expect(res.duration).toBe(1);
    expect(res.segments?.[0]).toMatchObject({ id: 0, seek: 0, start: 0, end: 0.5, text: 'Halo dunia.', tokens: [] });
    expect(res.words?.map((w) => w.word)).toEqual(['Halo', 'dunia.', 'Apa']);
  });

  test('text, srt and vtt come back as strings', async () => {
    const text = await sdk.audio.transcriptions.create({ file: await file(), model: 'whisper-1', response_format: 'text' });
    expect(text).toBe(TRANSCRIPT.text);
    const srt = await sdk.audio.transcriptions.create({ file: await file(), model: 'whisper-1', response_format: 'srt' });
    expect(srt).toContain('1\n00:00:00,000 --> 00:00:00,500\nHalo dunia.');
    const vtt = await sdk.audio.transcriptions.create({ file: await file(), model: 'whisper-1', response_format: 'vtt' });
    expect(vtt.startsWith('WEBVTT')).toBe(true);
    expect(vtt).toContain('00:00:00.500 --> 00:00:01.000\nApa kabar?');
  });

  test('an unknown model is a BadRequestError on param model', async () => {
    const err = await sdk.audio.transcriptions.create({ file: await file(), model: 'gpt-4o' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestError);
    expect((err as BadRequestError).param).toBe('model');
    expect(fakeStt.last).toBeNull();
  });

  test('a busy engine is 429 with Retry-After', async () => {
    fakeStt.mode = 'busy';
    const err = await sdk.audio.transcriptions.create({ file: await file(), model: 'whisper-1' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).code).toBe('engine_busy');
    expect((err as RateLimitError).headers.get('retry-after')).toBe('7');
  });

  test('busy before the first delta is still a clean 429 when streaming', async () => {
    fakeStt.mode = 'busy';
    const err = await sdk.audio.transcriptions
      .create({ file: await file(), model: 'whisper-1', stream: true })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
  });

  test('no credentials is an OpenAI-shaped 401', async () => {
    const err = await client('not-a-session')
      .audio.transcriptions.create({ file: await file(), model: 'whisper-1' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthenticationError);
    expect((err as AuthenticationError).error).toMatchObject({ type: 'authentication_error', code: 'invalid_api_key' });
  });

  test('an unknown /api/v1 path is an OpenAI-shaped 404', async () => {
    const err = await sdk.get('/nope').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect((err as NotFoundError).error).toMatchObject({ type: 'not_found_error', message: 'Invalid URL (GET /api/v1/nope)' });
  });
});

describe('raw /api/v1/audio/transcriptions', () => {
  const post = (fd: FormData, auth = true) =>
    call('/api/v1/audio/transcriptions', {
      method: 'POST',
      body: fd,
      headers: auth ? { authorization: `Bearer ${SESSION_TOKEN}` } : {},
    });
  const errorOf = async (res: Response) => ((await res.json()) as { error: Record<string, unknown> }).error;

  test('validates fields with OpenAI 400s', async () => {
    const cases: [Record<string, string | string[]>, Uint8Array<ArrayBuffer> | null, string][] = [
      [{ model: 'whisper-1' }, null, 'file'],
      [{}, wav, 'model'],
      [{ model: 'whisper-1', response_format: 'diarized_json' }, wav, 'response_format'],
      [{ model: 'whisper-1', response_format: 'srt', stream: 'true' }, wav, 'stream'],
      [{ model: 'whisper-1', language: 'indonesian' }, wav, 'language'],
      [{ model: 'whisper-1', 'timestamp_granularities[]': 'char' }, wav, 'timestamp_granularities'],
    ];
    for (const [fields, f, param] of cases) {
      const res = await post(form(fields, f));
      expect(res.status).toBe(400);
      const err = await errorOf(res);
      expect(err).toMatchObject({ type: 'invalid_request_error', param });
    }
    expect(fakeStt.last).toBeNull();
  });

  test('non-WAV audio without ffmpeg is 400 unsupported_format', async () => {
    const prev = process.env.V1_FFMPEG_PATH;
    process.env.V1_FFMPEG_PATH = '/nonexistent/ffmpeg-for-test';
    try {
      const res = await post(form({ model: 'whisper-1' }, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]), 'a.mp3'));
      expect(res.status).toBe(400);
      expect(await errorOf(res)).toMatchObject({ code: 'unsupported_format', param: 'file' });
    } finally {
      if (prev === undefined) delete process.env.V1_FFMPEG_PATH;
      else process.env.V1_FFMPEG_PATH = prev;
    }
  });

  test('upload and duration limits: 413 and 400 audio_too_long', async () => {
    process.env.V1_MAX_AUDIO_SEC = '0.5';
    const long = await post(form({ model: 'whisper-1' }, wav));
    delete process.env.V1_MAX_AUDIO_SEC;
    expect(long.status).toBe(400);
    expect((await errorOf(long)).code).toBe('audio_too_long');

    process.env.V1_MAX_UPLOAD_MB = '0.01';
    const big = await post(form({ model: 'whisper-1' }, wav));
    delete process.env.V1_MAX_UPLOAD_MB;
    expect(big.status).toBe(413);
    expect((await errorOf(big)).code).toBe('file_too_large');
  });

  test('engine failure is a 500 server_error without internals, with x-request-id', async () => {
    fakeStt.mode = 'boom';
    const res = await post(form({ model: 'whisper-1' }, wav));
    expect(res.status).toBe(500);
    expect(res.headers.get('x-request-id')).toBeTruthy();
    const body = await res.text();
    expect(body).not.toContain('secret');
    expect(JSON.parse(body).error).toMatchObject({ type: 'server_error', code: 'server_error' });
  });

  test('client disconnect aborts the engine signal', async () => {
    fakeStt.mode = 'hang-after-delta';
    const res = await post(form({ model: 'whisper-1', stream: 'true' }, wav));
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toBe(`data: ${JSON.stringify({ type: 'transcript.text.delta', delta: DELTAS[0] })}\n\n`);
    await reader.cancel();
    expect(fakeStt.aborted).toBe(true);
  });

  test('translations is 400 unsupported', async () => {
    const res = await post(form({ model: 'whisper-1' }, wav));
    expect(res.status).toBe(200);
    const tr = await call('/api/v1/audio/translations', {
      method: 'POST',
      body: form({ model: 'whisper-1' }, wav),
      headers: { authorization: `Bearer ${SESSION_TOKEN}` },
    });
    expect(tr.status).toBe(400);
    expect((await errorOf(tr)).code).toBe('unsupported');
  });

  test('logs exactly one info line per request, never the transcript', async () => {
    const info = spyOn(logger, 'info');
    try {
      await post(form({ model: 'whisper-1' }, wav));
      const lines = info.mock.calls.filter((c) => c[1] === 'stt transcription');
      expect(lines).toHaveLength(1);
      expect(lines[0][0]).toMatchObject({ model: 'whisper-1', bytes: wav.length, durationSec: 1, stream: false, status: 200 });
      expect(JSON.stringify(info.mock.calls)).not.toContain('Halo');
    } finally {
      info.mockRestore();
    }
  });
});
