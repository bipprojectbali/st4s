/** Transcription fields that must match the OpenAI SDK types: verbose_json `language` name, stream `usage`. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import OpenAI, { toFile } from 'openai';
import type { TranscriptionStreamEvent } from 'openai/resources/audio/transcriptions';
import { setEngines } from '../../server/engines/registry';
import { languageName } from '../../server/v1/transcriptions.output';
import { appFetch, fakeStt, resetFake, SESSION_TOKEN, stubSession } from './fake-stt';
import { makeWav } from './wav-fixture';

const wav = makeWav({ sampleRate: 16_000, channels: 1, bits: 16, frames: 16_000 });
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
  spies = stubSession();
  setEngines({ stt: fakeStt });
});
afterAll(() => {
  for (const s of spies) s.mockRestore();
  setEngines({ stt: null });
});

describe('languageName', () => {
  test('maps ISO 639 codes to lowercase English names like whisper-1', () => {
    expect(languageName('id')).toBe('indonesian');
    expect(languageName('en')).toBe('english');
    expect(languageName('yue')).toBe('cantonese');
  });

  test('passes through unknown, empty and non-code values', () => {
    for (const v of ['unknown', 'zz', '', 'auto', 'x']) expect(languageName(v)).toBe(v);
  });
});

describe('SDK response shapes', () => {
  test('verbose_json reports the language name and duration usage', async () => {
    const res = await sdk.audio.transcriptions.create({
      file: await file(),
      model: 'whisper-1',
      response_format: 'verbose_json',
    });
    expect(res.language).toBe('indonesian');
    expect(res.usage).toEqual({ type: 'duration', seconds: 1 });
  });

  test('json keeps duration usage (allowed by Transcription.usage)', async () => {
    const res = await sdk.audio.transcriptions.create({ file: await file(), model: 'whisper-1' });
    expect(res.usage).toEqual({ type: 'duration', seconds: 1 });
  });

  test('stream done event carries no usage (SDK allows only token usage there)', async () => {
    const stream = await sdk.audio.transcriptions.create({
      file: await file(),
      model: 'gpt-4o-mini-transcribe',
      stream: true,
    });
    const events: TranscriptionStreamEvent[] = [];
    for await (const e of stream) events.push(e);
    const done = events.at(-1);
    expect(done).toEqual({ type: 'transcript.text.done', text: 'Halo dunia. Apa kabar?' });
    expect(events.filter((e) => e.type === 'transcript.text.delta')).toHaveLength(3);
  });
});
