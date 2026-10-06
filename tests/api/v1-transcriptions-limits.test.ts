/** /api/v1/audio/transcriptions admission control, unload mapping, hotword caps and the mid-stream SSE error. */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test';
import * as decodeMod from '../../server/audio/decode';
import { findFfmpeg } from '../../server/audio/decode-ffmpeg';
import { setEngines } from '../../server/engines/registry';
import { Semaphore } from '../../server/v1/transcriptions.limits';
import { call, DELTAS, fakeStt, form, resetFake, SESSION_TOKEN, stubSession } from '../v1/fake-stt';
import { ffmpegTone, makeWav } from '../v1/wav-fixture';

const wav = makeWav({ sampleRate: 16_000, channels: 1, bits: 16, frames: 16_000 });
const post = (fd: FormData) =>
  call('/api/v1/audio/transcriptions', {
    method: 'POST',
    body: fd,
    headers: { authorization: `Bearer ${SESSION_TOKEN}` },
  });
const errorOf = async (res: Response) =>
  ((await res.json()) as { error: Record<string, unknown> }).error;
const ENV_KEYS = [
  'STT_MAX_QUEUE',
  'V1_DECODE_CONCURRENCY',
  'V1_DECODE_WAIT_MS',
  'V1_MAX_AUDIO_SEC',
];

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
afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe('Semaphore', () => {
  test('never exceeds its limit and hands slots to waiters in order', async () => {
    const sem = new Semaphore(() => 2);
    let running = 0;
    let peak = 0;
    const job = async () => {
      const release = await sem.acquire(1_000);
      expect(release).not.toBeNull();
      running++;
      peak = Math.max(peak, running);
      await Bun.sleep(5);
      running--;
      release!();
      release!(); // idempotent: a double release must not free an extra slot
    };
    await Promise.all(Array.from({ length: 6 }, job));
    expect(peak).toBe(2);
    expect(sem.active).toBe(0);
  });

  test('a waiter that times out gets null and does not take a slot later', async () => {
    const sem = new Semaphore(() => 1);
    const held = await sem.acquire(10);
    expect(await sem.acquire(10)).toBeNull();
    held!();
    expect(sem.active).toBe(0);
  });
});

describe('admission control', () => {
  test('a full STT queue is 429 + Retry-After before the audio is decoded', async () => {
    const decode = spyOn(decodeMod, 'decodeTo16kMono');
    try {
      process.env.STT_MAX_QUEUE = '2';
      fakeStt.queued = 2;
      const res = await post(form({ model: 'whisper-1' }, wav));
      expect(res.status).toBe(429);
      expect(Number(res.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
      expect(await errorOf(res)).toMatchObject({ code: 'engine_busy' });
      expect(decode).not.toHaveBeenCalled();
      expect(fakeStt.last).toBeNull();
    } finally {
      decode.mockRestore();
    }
  });

  test('decoding is bounded by V1_DECODE_CONCURRENCY; a long wait is 429', async () => {
    let inFlight = 0;
    let peak = 0;
    const real = decodeMod.decodeTo16kMono;
    const decode = spyOn(decodeMod, 'decodeTo16kMono').mockImplementation(async (...args) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Bun.sleep(150);
      inFlight--;
      return real(...args);
    });
    try {
      process.env.V1_DECODE_CONCURRENCY = '1';
      process.env.V1_DECODE_WAIT_MS = '30';
      const [a, b] = await Promise.all([
        post(form({ model: 'whisper-1' }, wav)),
        post(form({ model: 'whisper-1' }, wav)),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 429]);
      const busy = a.status === 429 ? a : b;
      expect(busy.headers.get('retry-after')).toBe('1');
      expect(peak).toBe(1);
      expect(decode).toHaveBeenCalledTimes(1);
    } finally {
      decode.mockRestore();
    }
  });
});

describe('V1_MAX_AUDIO_SEC is enforced while decoding', () => {
  const secs = (n: number) =>
    makeWav({ sampleRate: 16_000, channels: 1, bits: 16, frames: n * 16_000 });

  test('a 20 s WAV over a 5 s cap is 400 audio_too_long with its real duration; 3 s is 200', async () => {
    process.env.V1_MAX_AUDIO_SEC = '5';
    const long = await post(form({ model: 'whisper-1' }, secs(20)));
    expect(long.status).toBe(400);
    const err = await errorOf(long);
    expect(err).toMatchObject({ code: 'audio_too_long', param: 'file' });
    expect(err.message).toContain('20 dtk');
    expect(fakeStt.last).toBeNull();

    const ok = await post(form({ model: 'whisper-1' }, secs(3)));
    expect(ok.status).toBe(200);
    expect(fakeStt.last?.audio.length).toBe(48_000);
  });

  test.skipIf(!findFfmpeg())(
    'a 20 s ffmpeg upload over a 5 s cap is 400 audio_too_long without a claimed duration',
    async () => {
      process.env.V1_MAX_AUDIO_SEC = '5';
      const res = await post(
        form({ model: 'whisper-1' }, ffmpegTone(findFfmpeg() as string, 20), 'a.flac'),
      );
      expect(res.status).toBe(400);
      const err = await errorOf(res);
      expect(err).toMatchObject({ code: 'audio_too_long', param: 'file' });
      expect(err.message).toBe(
        'Durasi audio melebihi batas 5 dtk. Potong rekaman menjadi beberapa bagian lalu kirim per bagian.',
      );
      expect(fakeStt.last).toBeNull();
    },
  );
});

describe('engine errors and validation', () => {
  test('a job lost to an unload is 503 engine_unloaded + Retry-After', async () => {
    fakeStt.mode = 'unloaded';
    const res = await post(form({ model: 'whisper-1' }, wav));
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('5');
    expect(await errorOf(res)).toMatchObject({ code: 'engine_unloaded' });
  });

  test('hotword caps: >50 terms or >1000 chars is 400 on param keywords', async () => {
    const many = Array.from({ length: 51 }, (_, i) => `t${i}`).join(',');
    const long = Array.from({ length: 11 }, (_, i) => `${i}`.padEnd(100, 'x')).join(',');
    for (const keywords of [many, long]) {
      const res = await post(form({ model: 'whisper-1', keywords }, wav));
      expect(res.status).toBe(400);
      expect(await errorOf(res)).toMatchObject({
        type: 'invalid_request_error',
        param: 'keywords',
      });
    }
    const ok = await post(
      form(
        { model: 'whisper-1', keywords: Array.from({ length: 50 }, (_, i) => `t${i}`).join(',') },
        wav,
      ),
    );
    expect(ok.status).toBe(200);
    expect(fakeStt.last?.hotwords).toHaveLength(50);
  });

  test('a failure after the first delta ends the stream with a typed error event', async () => {
    fakeStt.mode = 'boom-after-delta';
    const res = await post(form({ model: 'whisper-1', stream: 'true' }, wav));
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const events = (await res.text())
      .split('\n\n')
      .filter(Boolean)
      .map((e) => JSON.parse(e.replace(/^data: /, '')));
    expect(events[0]).toEqual({ type: 'transcript.text.delta', delta: DELTAS[0] });
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      error: { type: 'server_error', code: 'server_error' },
    });
  });
});
