import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import Elysia from 'elysia';
import OpenAI from 'openai';
import { ffmpegAvailable } from '../../server/audio/encode-ffmpeg';
import { auth } from '../../server/auth';
import { setEngines } from '../../server/engines/registry';
import { createTtsEngine } from '../../server/engines/tts';
import { EngineBusyError, type SpeakRequest, type TtsEngine } from '../../server/engines/types';
import * as rolesMod from '../../server/roles';
import { NATIVE_VOICES } from '../../server/v1/aliases';
import { speechApi } from '../../server/v1/speech';

const RATE = 24_000;
const SAMPLES = 2_400;

class FakeTts implements TtsEngine {
  readonly sampleRate = RATE;
  calls: SpeakRequest[] = [];
  aborts = 0;
  busy = false;
  delayMs = 0;
  voices() {
    return NATIVE_VOICES;
  }
  async synthesize(req: SpeakRequest): Promise<Float32Array> {
    this.calls.push(req);
    if (this.busy) throw new EngineBusyError('tts', 3);
    if (this.delayMs)
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, this.delayMs);
        req.signal?.addEventListener('abort', () => {
          clearTimeout(t);
          this.aborts++;
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    return new Float32Array(SAMPLES).map((_, i) => 0.3 * Math.sin((2 * Math.PI * 440 * i) / RATE));
  }
  status() {
    const stats = { requests: 0, errors: 0, p50Ms: null, p95Ms: null, rtfP50: null };
    return {
      kind: 'tts' as const,
      model: 'fake',
      state: 'ready' as const,
      queued: 0,
      loadedAt: null,
      lastError: null,
      rssBytes: null,
      stats,
    };
  }
  async warmup() {}
  async unload() {}
}

const fake = new FakeTts();
setEngines({ tts: fake });
const ctx: { signedIn: boolean } = { signedIn: true };
const spies = [
  spyOn(auth.api, 'getSession').mockImplementation((async () =>
    ctx.signedIn
      ? { user: { id: 'v1-speech-test', email: 'v1-speech@test.local' } }
      : null) as unknown as typeof auth.api.getSession),
  spyOn(rolesMod, 'resolveUserRole').mockImplementation(async () => 'user' as const),
];
const app = new Elysia({ prefix: '/api/v1' }).use(speechApi);

beforeEach(() => {
  Object.assign(fake, { calls: [], aborts: 0, busy: false, delayMs: 0 });
  ctx.signedIn = true;
});
afterAll(() => {
  for (const s of spies) s.mockRestore();
});

const speak = (body: unknown, signal?: AbortSignal) =>
  app.handle(
    new Request('http://localhost/api/v1/audio/speech', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    }),
  );
const ok = (extra: Record<string, unknown>) => ({
  model: 'tts-1',
  voice: 'alloy',
  input: 'Halo dunia.',
  ...extra,
});
const bytes = async (res: Response) => new Uint8Array(await res.arrayBuffer());

describe('POST /api/v1/audio/speech', () => {
  test('wav, single unit: exact header and sample count', async () => {
    const res = await speak(ok({ response_format: 'wav' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/wav');
    const b = await bytes(res);
    const v = new DataView(b.buffer);
    expect(new TextDecoder().decode(b.slice(0, 4))).toBe('RIFF');
    expect(v.getUint32(24, true)).toBe(RATE);
    expect(v.getUint32(40, true)).toBe(SAMPLES * 2);
    expect((b.length - 44) / 2).toBe(SAMPLES);
    expect(fake.calls[0]).toMatchObject({ voice: 'F1', language: 'id', speed: 1 });
  });

  test('wav, multi unit: streaming header, all samples', async () => {
    const b = await bytes(
      await speak(ok({ response_format: 'wav', input: 'Satu.\n\nDua.\n\nTiga.' })),
    );
    expect(new DataView(b.buffer).getUint32(40, true)).toBe(0xffffffff);
    expect(b.length).toBe(44 + 2 * 3 * SAMPLES);
  });

  test('pcm length = 2 × samples; first unit is the first sentence', async () => {
    const res = await speak(
      ok({
        response_format: 'pcm',
        input: 'Halo. Ini kalimat kedua. Dan ketiga.',
        speed: 1.5,
        steps: 99,
        language: 'EN',
      }),
    );
    expect(res.headers.get('content-type')).toBe('audio/pcm');
    expect((await bytes(res)).length).toBe(2 * 2 * SAMPLES);
    expect(fake.calls.map((c) => c.text)).toEqual(['Halo.', 'Ini kalimat kedua. Dan ketiga.']);
    expect(fake.calls[0]).toMatchObject({ speed: 1.5, steps: 20, language: 'en' });
  });

  test('sse yields one delta per unit, then done with usage', async () => {
    const res = await speak(
      ok({
        model: 'supertonic-3',
        response_format: 'pcm',
        stream_format: 'sse',
        input: 'Satu.\n\nDua.\n\nTiga.',
      }),
    );
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const events = (await res.text())
      .split('\n\n')
      .filter(Boolean)
      .map((e) => JSON.parse(e.replace(/^data: /, '')));
    const deltas = events.filter((e) => e.type === 'speech.audio.delta');
    expect(deltas.length).toBe(3);
    expect(Buffer.from(deltas[0].audio, 'base64').length).toBe(2 * SAMPLES);
    expect(events.at(-1)).toEqual({
      type: 'speech.audio.done',
      usage: { input_tokens: 5, output_tokens: 0, total_tokens: 5 },
    });
  });

  test('client cancel mid-stream stops further engine calls', async () => {
    fake.delayMs = 150;
    const res = await speak(
      ok({ response_format: 'pcm', input: 'Satu.\n\nDua.\n\nTiga.\n\nEmpat.' }),
    );
    const reader = res.body!.getReader();
    expect((await reader.read()).value!.length).toBe(2 * SAMPLES);
    await reader.cancel();
    await Bun.sleep(400);
    expect(fake.calls.length).toBe(2);
    expect(fake.aborts).toBeGreaterThanOrEqual(1);
  });

  test.each([
    [{ voice: 'nope' }, 'voice'],
    [{ model: undefined }, 'model'],
    [{ model: 'whisper-1' }, 'model'],
    [{ input: '' }, 'input'],
    [{ input: '  \n\n ' }, 'input'],
    [{ language: 'xx' }, 'language'],
    [{ input: 'a'.repeat(4097) }, 'input'],
    [{ speed: 9 }, 'speed'],
    [{ response_format: 'ogg' }, 'response_format'],
    [{ stream_format: 'sse' }, 'stream_format'],
  ])('400 OpenAI-shaped for %o', async (extra, param) => {
    const res = await speak(ok(extra));
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: Record<string, unknown> };
    expect(error.param).toBe(param);
    expect(error.type).toBe('invalid_request_error');
    expect(typeof error.message).toBe('string');
    expect(fake.calls.length).toBe(0);
  });

  test('model codes: missing → missing_required_parameter, STT model → invalid_value', async () => {
    const codeOf = async (extra: Record<string, unknown>) =>
      ((await (await speak(ok(extra))).json()) as { error: { code: string } }).error.code;
    expect(await codeOf({ model: undefined })).toBe('missing_required_parameter');
    expect(await codeOf({ model: 'qwen3-asr-1.7b' })).toBe('invalid_value');
  });

  test('unknown model → 404 model_not_found in OpenAI shape', async () => {
    const res = await speak(ok({ model: 'gpt-4' }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: {
        message: expect.any(String),
        type: 'invalid_request_error',
        param: 'model',
        code: 'model_not_found',
      },
    });
    expect(fake.calls.length).toBe(0);
  });

  test('engine busy before first byte → 429 + Retry-After', async () => {
    fake.busy = true;
    const res = await speak(ok({}));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('3');
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('engine_busy');
  });

  test('missing TTS model dir → 503 engine_unavailable, no synthesis', async () => {
    // Real engine with a model dir that does not exist: the sampleRate getter throws; no child is spawned.
    setEngines({ tts: createTtsEngine({ config: { modelDir: '/nonexistent-st4s-tts-model' } }) });
    try {
      const res = await speak(ok({ response_format: 'wav' }));
      expect(res.status).toBe(503);
      const { error } = (await res.json()) as {
        error: { code: string; type: string; message: string };
      };
      expect(error.code).toBe('engine_unavailable');
      expect(error.message).not.toContain('/nonexistent');
    } finally {
      setEngines({ tts: fake });
    }
  });

  test('anonymous caller → 401', async () => {
    ctx.signedIn = false;
    const res = await speak(ok({}));
    expect(res.status).toBe(401);
    expect(fake.calls.length).toBe(0);
  });

  test.skipIf(!ffmpegAvailable('ffmpeg'))('mp3 (default) via ffmpeg', async () => {
    const res = await speak({ model: 'tts-1', voice: 'nova', input: 'Halo. Apa kabar?' });
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    const b = await bytes(res);
    const id3 = new TextDecoder().decode(b.slice(0, 3)) === 'ID3';
    expect(id3 || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)).toBe(true);
  });
});

describe('openai SDK against /api/v1', () => {
  const client = new OpenAI({
    apiKey: 'test',
    baseURL: 'http://localhost/api/v1',
    maxRetries: 0,
    fetch: (url, init) => app.handle(new Request(url, init)),
  });

  test('speech.create wav and pcm', async () => {
    const wav = await client.audio.speech.create({
      model: 'tts-1',
      voice: 'alloy',
      input: 'Halo dunia.',
      response_format: 'wav',
    });
    expect((await wav.arrayBuffer()).byteLength).toBe(44 + 2 * SAMPLES);
    const pcm = await client.audio.speech.create({
      model: 'gpt-4o-mini-tts',
      voice: 'echo',
      input: 'Halo.',
      response_format: 'pcm',
      instructions: 'ceria',
    });
    expect((await pcm.arrayBuffer()).byteLength).toBe(2 * SAMPLES);
  });

  test('bad voice surfaces as BadRequestError with param', async () => {
    const err = await client.audio.speech
      .create({ model: 'tts-1', voice: 'nope' as 'alloy', input: 'Halo.' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OpenAI.BadRequestError);
    expect((err as InstanceType<typeof OpenAI.BadRequestError>).param).toBe('voice');
  });

  test('unknown model surfaces as NotFoundError with code model_not_found', async () => {
    const err = await client.audio.speech
      .create({ model: 'tts-9', voice: 'alloy', input: 'Halo.' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OpenAI.NotFoundError);
    expect((err as InstanceType<typeof OpenAI.NotFoundError>).code).toBe('model_not_found');
  });
});
