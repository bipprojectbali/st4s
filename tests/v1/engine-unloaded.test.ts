import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import Elysia from 'elysia';
import { auth } from '../../server/auth';
import {
  EngineUnloadedError,
  engineUnloadedApiError,
  isEngineUnloadedError,
} from '../../server/engines/errors';
import { setEngines } from '../../server/engines/registry';
import type { SttEngine, TtsEngine } from '../../server/engines/types';
import * as rolesMod from '../../server/roles';
import { NATIVE_VOICES } from '../../server/v1/aliases';
import { speechApi } from '../../server/v1/speech';
import { engineErrorResponse, streamTranscript } from '../../server/v1/transcriptions.output';

const stats = { requests: 0, errors: 0, p50Ms: null, p95Ms: null, rtfP50: null };
const control = { warmup: async () => {}, unload: async () => {} };

const unloadedTts: TtsEngine = {
  sampleRate: 24_000,
  voices: () => NATIVE_VOICES,
  synthesize: async () => {
    throw new EngineUnloadedError('tts');
  },
  status: () => ({
    kind: 'tts',
    model: 'fake',
    state: 'unloaded',
    queued: 0,
    loadedAt: null,
    lastError: null,
    rssBytes: null,
    stats,
  }),
  ...control,
};

const spies = [
  spyOn(auth.api, 'getSession').mockImplementation((async () => ({
    user: { id: 'v1-unloaded-test', email: 'v1-unloaded@test.local' },
  })) as unknown as typeof auth.api.getSession),
  spyOn(rolesMod, 'resolveUserRole').mockImplementation(async () => 'user' as const),
];
afterAll(() => {
  for (const s of spies) s.mockRestore();
  setEngines({ tts: null });
});

type V1Body = { error: { message: string; type: string; code: string } };

describe('EngineUnloadedError mapping', () => {
  test('STT: 503 engine_unloaded (server_error) + Retry-After 5', async () => {
    const res = engineErrorResponse(new EngineUnloadedError('stt'), 'rid');
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('5');
    const body = (await res.json()) as V1Body;
    expect(body.error).toMatchObject({ type: 'server_error', code: 'engine_unloaded' });
    expect(body.error.message).toContain('STT');
  });

  test('TTS /audio/speech: 503 engine_unloaded + Retry-After 5', async () => {
    setEngines({ tts: unloadedTts });
    const app = new Elysia({ prefix: '/api/v1' }).use(speechApi);
    const res = await app.handle(
      new Request('http://localhost/api/v1/audio/speech', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer x' },
        body: JSON.stringify({
          model: 'tts-1',
          input: 'Halo.',
          voice: 'alloy',
          response_format: 'wav',
        }),
      }),
    );
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('5');
    expect(((await res.json()) as V1Body).error).toMatchObject({
      type: 'server_error',
      code: 'engine_unloaded',
    });
  });

  test('STT stream: unload after the first delta ends with an engine_unloaded error event', async () => {
    const engine: SttEngine = {
      async transcribe(req) {
        req.onDelta?.('Halo');
        await Bun.sleep(1);
        throw new EngineUnloadedError('stt');
      },
      status: () => ({
        kind: 'stt',
        model: 'fake',
        state: 'unloaded',
        queued: 0,
        loadedAt: null,
        lastError: null,
        rssBytes: null,
        stats,
      }),
      ...control,
    };
    let ended = 0;
    const res = await streamTranscript({
      engine,
      req: { audio: new Float32Array(16) },
      ctrl: new AbortController(),
      requestId: 'rid',
      onEnd: (s) => (ended = s),
    });
    const text = await res.text();
    expect(text).toContain('"code":"engine_unloaded"');
    expect(text).not.toContain('"code":"server_error"');
    expect(ended).toBe(503);
  });

  test('non-v1 helper uses the template shape with an actionable Indonesian message', () => {
    expect(isEngineUnloadedError(new EngineUnloadedError('tts'))).toBe(true);
    expect(isEngineUnloadedError(new Error('x'))).toBe(false);
    expect(engineUnloadedApiError('req1')).toEqual({
      error: 'Engine dihentikan karena RAM menipis atau idle. Coba lagi.',
      code: 'ENGINE_UNLOADED',
      status: 503,
      requestId: 'req1',
    });
  });
});
