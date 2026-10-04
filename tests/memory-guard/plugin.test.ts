/** Shedding plugin on the real /v1 router: 503 memory_pressure in OpenAI shape with Retry-After, only for /v1/audio/*. */
import { afterAll, afterEach, describe, expect, spyOn, test } from 'bun:test';
import Elysia from 'elysia';
import { auth } from '../../server/auth';
import { type Admission, setGuardHandle } from '../../server/memory-guard/state';
import * as rolesMod from '../../server/roles';
import { v1Api } from '../../server/v1';

const spies = [
  spyOn(auth.api, 'getSession').mockImplementation((async () => ({
    user: { id: 'mem-guard-test', email: 'mem-guard@test.local' },
  })) as unknown as typeof auth.api.getSession),
  spyOn(rolesMod, 'resolveUserRole').mockImplementation(async () => 'user' as const),
];
afterAll(() => {
  for (const sp of spies) sp.mockRestore();
});
afterEach(() => setGuardHandle(null));

const app = new Elysia({ prefix: '/api' }).use(v1Api);
let admits = 0;
function install(a: Admission) {
  admits = 0;
  setGuardHandle({
    status: () => {
      throw new Error('not used');
    },
    admit: () => {
      admits++;
      return a;
    },
  });
}

const codeOf = async (res: Response) => ((await res.json()) as { error?: { code?: string } }).error?.code;

const speech = () =>
  app.handle(
    new Request('http://localhost/api/v1/audio/speech', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': 'req-mg-1' },
      body: JSON.stringify({ model: 'tts-1', input: 'halo', voice: 'alloy' }),
    }),
  );

describe('memoryGuardPlugin', () => {
  test('sheds speech and transcription requests with 503 + Retry-After', async () => {
    install({ ok: false, retryAfterSec: 12 });
    const res = await speech();
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('12');
    expect(res.headers.get('x-request-id')).toBe('req-mg-1');
    const body = (await res.json()) as { error: { message: string; type: string; code: string } };
    expect(body.error).toMatchObject({ type: 'server_error', code: 'memory_pressure', param: null });
    expect(body.error.message).toContain('12 detik');

    const form = new FormData();
    form.set('model', 'whisper-1');
    form.set('file', new File([new Uint8Array(8)], 'a.wav', { type: 'audio/wav' }));
    const stt = await app.handle(new Request('http://localhost/api/v1/audio/transcriptions', { method: 'POST', body: form }));
    expect(stt.status).toBe(503);
    expect(admits).toBe(2);
  });

  test('does not touch non-audio v1 routes', async () => {
    install({ ok: false, retryAfterSec: 5 });
    const res = await app.handle(new Request('http://localhost/api/v1/models'));
    expect(res.status).toBe(200);
    expect(admits).toBe(0);
  });

  test('admits (and wakes the guard) when RAM is fine; no guard means always admit', async () => {
    install({ ok: true });
    expect(await codeOf(await speech())).not.toBe('memory_pressure');
    expect(admits).toBe(1);
    setGuardHandle(null);
    expect(await codeOf(await speech())).not.toBe('memory_pressure');
  });
});
