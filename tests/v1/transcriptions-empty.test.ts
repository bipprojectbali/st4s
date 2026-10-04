/** Silent audio (empty transcript) in every response_format and the stream, through the openai SDK. */
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import OpenAI, { toFile } from 'openai';
import { setEngines } from '../../server/engines/registry';
import type { TranscribeResult } from '../../server/engines/types';
import { appFetch, call, fakeStt, form, resetFake, SESSION_TOKEN, stubSession } from './fake-stt';
import { makeWav } from './wav-fixture';

// Mirrors server/engines/stt/spans.ts when Silero hears no speech.
const SILENT: TranscribeResult = { text: '', language: 'unknown', duration: 1.2, segments: [] };

const wav = makeWav({ sampleRate: 16_000, channels: 1, bits: 16, frames: 19_200 });
const sdk = new OpenAI({
  apiKey: SESSION_TOKEN,
  baseURL: 'http://localhost/api/v1',
  fetch: appFetch,
  maxRetries: 0,
});
const file = () => toFile(wav, 'a.wav', { type: 'audio/wav' });

let spies: { mockRestore(): void }[] = [];
beforeAll(() => {
  resetFake();
  spies = [
    ...stubSession(),
    spyOn(fakeStt, 'transcribe').mockImplementation(async (req) => {
      req.onDelta?.('');
      return SILENT;
    }),
  ];
  setEngines({ stt: fakeStt });
});
afterAll(() => {
  for (const s of spies) s.mockRestore();
  setEngines({ stt: null });
});

describe('empty transcript', () => {
  test('json → { text: "", usage }', async () => {
    const res = await sdk.audio.transcriptions.create({ file: await file(), model: 'whisper-1' });
    expect(res).toEqual({ text: '', usage: { type: 'duration', seconds: 2 } } as typeof res);
  });

  test('text / srt → empty plain-text body', async () => {
    for (const response_format of ['text', 'srt'] as const) {
      const out = await sdk.audio.transcriptions.create({
        file: await file(),
        model: 'whisper-1',
        response_format,
      });
      expect(out).toBe('');
    }
  });

  test('vtt → still a valid WebVTT file (header only)', async () => {
    const res = await call('/api/v1/audio/transcriptions', {
      method: 'POST',
      headers: { authorization: `Bearer ${SESSION_TOKEN}` },
      body: form({ model: 'whisper-1', response_format: 'vtt' }, wav),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/vtt; charset=utf-8');
    expect(await res.text()).toBe('WEBVTT\n');
  });

  test('verbose_json → required duration/language/text, empty segments and words', async () => {
    const res = await sdk.audio.transcriptions.create({
      file: await file(),
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['word', 'segment'],
    });
    expect(res).toMatchObject({
      task: 'transcribe',
      language: 'unknown',
      duration: 1.2,
      text: '',
      segments: [],
      words: [],
      usage: { type: 'duration', seconds: 2 },
    });
  });

  test('verbose_json without word granularity omits words', async () => {
    const res = await sdk.audio.transcriptions.create({
      file: await file(),
      model: 'whisper-1',
      response_format: 'verbose_json',
    });
    expect(res.segments).toEqual([]);
    expect(res).not.toHaveProperty('words');
  });

  test('stream → no delta events, a single transcript.text.done with text ""', async () => {
    const stream = await sdk.audio.transcriptions.create({
      file: await file(),
      model: 'gpt-4o-mini-transcribe',
      stream: true,
    });
    const events: { type: string; text?: string }[] = [];
    for await (const e of stream) events.push(e);
    expect(events).toEqual([
      { type: 'transcript.text.done', text: '', usage: { type: 'duration', seconds: 2 } },
    ] as unknown as typeof events);
  });
});
