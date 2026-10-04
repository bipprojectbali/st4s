// Real-engine e2e through /api/v1 + the openai SDK. Run only under the model lock (see .claude/rules/engines.md "Konvensi Engine Suara"):
// ST4S_REAL_ENGINE=1 NODE_ENV=test timeout 600 bun test tests/e2e/v1-real.test.ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import OpenAI, { toFile } from 'openai';
import { setEngines } from '../../server/engines/registry';
import { createSttEngine } from '../../server/engines/stt';
import { createTtsEngine } from '../../server/engines/tts';
import { appFetch, SESSION_TOKEN, stubSession } from '../v1/fake-stt';

const REAL = process.env.ST4S_REAL_ENGINE === '1';
const WAV = process.env.STT_TEST_WAV ?? path.join(os.homedir(), 'tmp/stt/audio.wav');
const MIN_WORD_ACCURACY = 0.8;
const SENTENCES = [
  { voice: 'F1', text: 'Selamat pagi, hari ini cuaca sangat cerah dan kami pergi ke pasar.' },
  { voice: 'M1', text: 'Tolong kirimkan laporan keuangan itu kepada saya sebelum makan siang.' },
];

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** 1 − word error rate (word-level Levenshtein / reference length), floored at 0. */
function wordAccuracy(reference: string, hypothesis: string): number {
  const r = words(reference);
  const h = words(hypothesis);
  let prev = Array.from({ length: h.length + 1 }, (_, j) => j);
  for (let i = 1; i <= r.length; i++) {
    const cur = [i];
    for (let j = 1; j <= h.length; j++)
      cur[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (cur[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + (r[i - 1] === h[j - 1] ? 0 : 1),
      );
    prev = cur;
  }
  return Math.max(0, 1 - (prev[h.length] ?? 0) / r.length);
}

test('wordAccuracy ignores case/punctuation and counts edits', () => {
  expect(wordAccuracy('Halo, Dunia!', 'halo dunia')).toBe(1);
  expect(wordAccuracy('a b c d', 'a x c')).toBe(0.5);
});

describe.skipIf(!REAL)('e2e /api/v1 with real engines', () => {
  const stt = createSttEngine({ config: { idleTimeoutSec: 0 } });
  const tts = createTtsEngine({ config: { idleTimeoutSec: 0 } });
  const sdk = new OpenAI({
    apiKey: SESSION_TOKEN,
    baseURL: 'http://localhost/api/v1',
    fetch: appFetch,
    maxRetries: 0,
  });
  let spies: { mockRestore(): void }[] = [];

  beforeAll(() => {
    spies = stubSession();
    setEngines({ stt, tts });
  });
  afterAll(async () => {
    await Promise.all([stt.unload(), tts.unload()]);
    setEngines({ stt: null, tts: null });
    for (const s of spies) s.mockRestore();
  });

  test('transcribes audio.wav non-stream and stream=true', async () => {
    const bytes = new Uint8Array(await Bun.file(WAV).arrayBuffer());
    const file = () => toFile(bytes, 'audio.wav', { type: 'audio/wav' });

    let t = performance.now();
    const res = await sdk.audio.transcriptions.create({ file: await file(), model: 'whisper-1' });
    const plainMs = performance.now() - t;
    expect(res.text.trim().length).toBeGreaterThan(0);

    t = performance.now();
    const stream = await sdk.audio.transcriptions.create({
      file: await file(),
      model: 'whisper-1',
      stream: true,
    });
    let deltas = 0;
    let firstDeltaMs: number | null = null;
    let done = '';
    for await (const ev of stream) {
      if (ev.type === 'transcript.text.delta') {
        deltas++;
        firstDeltaMs ??= performance.now() - t;
      } else if (ev.type === 'transcript.text.done') done = ev.text;
    }
    const streamMs = performance.now() - t;
    expect(deltas).toBeGreaterThanOrEqual(1);
    expect(done.trim().length).toBeGreaterThan(0);

    console.log(
      JSON.stringify({
        step: 'stt audio.wav',
        nonStreamMs: Math.round(plainMs),
        streamMs: Math.round(streamMs),
        firstDeltaMs: firstDeltaMs === null ? null : Math.round(firstDeltaMs),
        deltas,
        sttRssMB: Math.round((stt.status().rssBytes ?? 0) / 2 ** 20),
        text: res.text,
        streamText: done,
      }),
    );
    await stt.unload();
  }, 300_000);

  test('TTS → STT round trip keeps Indonesian intelligible', async () => {
    const wavs: { voice: string; text: string; wav: Uint8Array; ms: number }[] = [];
    for (const s of SENTENCES) {
      const t = performance.now();
      const res = await sdk.audio.speech.create({
        model: 'tts-1',
        voice: s.voice,
        input: s.text,
        response_format: 'wav',
        language: 'id',
      } as OpenAI.Audio.SpeechCreateParams);
      wavs.push({ ...s, wav: new Uint8Array(await res.arrayBuffer()), ms: performance.now() - t });
    }
    const ttsRssMB = Math.round((tts.status().rssBytes ?? 0) / 2 ** 20);
    await tts.unload();

    const results = [];
    for (const w of wavs) {
      expect(w.wav.length).toBeGreaterThan(44);
      const t = performance.now();
      const res = await sdk.audio.transcriptions.create({
        file: await toFile(w.wav, `${w.voice}.wav`, { type: 'audio/wav' }),
        model: 'whisper-1',
        language: 'id',
      });
      results.push({
        voice: w.voice,
        ttsMs: Math.round(w.ms),
        wavKB: Math.round(w.wav.length / 1024),
        sttMs: Math.round(performance.now() - t),
        accuracy: +wordAccuracy(w.text, res.text).toFixed(3),
        heard: res.text,
      });
    }
    console.log(JSON.stringify({ step: 'tts→stt', ttsRssMB, results }));
    for (const r of results) expect(r.accuracy).toBeGreaterThanOrEqual(MIN_WORD_ACCURACY);
  }, 300_000);
});
