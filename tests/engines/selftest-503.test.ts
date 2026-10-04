import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import Elysia from 'elysia';
import { auth } from '../../server/auth';
import { EngineNotReadyError, isEngineNotReadyError } from '../../server/engines/errors';
import { setEngines } from '../../server/engines/registry';
import type { TtsEngine } from '../../server/engines/types';
import * as rolesMod from '../../server/roles';
import { NATIVE_VOICES } from '../../server/v1/aliases';
import { speechApi } from '../../server/v1/speech';
import { engineErrorResponse } from '../../server/v1/transcriptions.output';

const DETAIL = 'Self-test gagal: model /secret/path/model.gguf rusak';

type V1Body = { error: { code: string; message: string } };

const notReadyTts = {
  sampleRate: 24_000,
  voices: () => NATIVE_VOICES,
  synthesize: async () => {
    throw new EngineNotReadyError('tts', DETAIL);
  },
  status: () => {
    throw new Error('unused');
  },
  warmup: async () => {},
  unload: async () => {},
} as unknown as TtsEngine;

const spies = [
  spyOn(auth.api, 'getSession').mockImplementation((async () => ({
    user: { id: 'selftest-503', email: 'selftest-503@test.local' },
  })) as unknown as typeof auth.api.getSession),
  spyOn(rolesMod, 'resolveUserRole').mockImplementation(async () => 'user' as const),
];
afterAll(() => {
  for (const s of spies) s.mockRestore();
  setEngines({ tts: undefined });
});

describe('EngineNotReadyError → 503 engine_unavailable', () => {
  test('message is generic; the detail stays on the error', () => {
    const e = new EngineNotReadyError('stt', DETAIL);
    expect(isEngineNotReadyError(e)).toBe(true);
    expect(e.detail).toBe(DETAIL);
    expect(e.message).toContain('Mesin STT gagal dimuat');
    expect(e.message).not.toContain('/secret');
  });

  test('transcriptions: engineErrorResponse maps to 503 without Retry-After', async () => {
    const res = engineErrorResponse(new EngineNotReadyError('stt', DETAIL), 'req-1');
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBeNull();
    const { error } = (await res.json()) as V1Body;
    expect(error.code).toBe('engine_unavailable');
    expect(error.message).not.toContain('/secret');
  });

  test('speech: first synth refused → 503 engine_unavailable', async () => {
    setEngines({ tts: notReadyTts });
    const app = new Elysia({ prefix: '/api/v1' }).use(speechApi);
    const res = await app.handle(
      new Request('http://localhost/api/v1/audio/speech', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'tts-1',
          voice: 'alloy',
          input: 'Halo.',
          response_format: 'wav',
        }),
      }),
    );
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBeNull();
    const { error } = (await res.json()) as V1Body;
    expect(error.code).toBe('engine_unavailable');
    expect(error.message).toContain('Mesin TTS gagal dimuat');
  });
});
