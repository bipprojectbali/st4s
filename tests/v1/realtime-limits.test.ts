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
import { api } from '../../server/api';
import { setEngines } from '../../server/engines/registry';
import { logger } from '../../server/logger';
import {
  type Admission,
  type MemoryGuardStatus,
  setGuardHandle,
} from '../../server/memory-guard/state';
import { realtimeActiveSessions, releaseRealtimeSlot } from '../../server/v1/realtime-server';
import { fakeStt, resetFake, SESSION_TOKEN, stubSession } from './fake-stt';
import { connect, pcmChunks, startServer, upgradeRequest } from './realtime-harness';

const spies = stubSession();
const warnSpy = spyOn(logger, 'warn');
/** Fields of the 'realtime upgrade refused' warn lines logged so far. */
const refusals = () =>
  warnSpy.mock.calls
    .filter((c) => c[1] === 'realtime upgrade refused')
    .map((c) => c[0] as Record<string, unknown>);
const AUTH = { authorization: `Bearer ${SESSION_TOKEN}` };
let server: ReturnType<typeof startServer>;

function guard(level: 'normal' | 'emergency', admission: Admission = { ok: true }) {
  setGuardHandle({
    status: () => ({ level }) as MemoryGuardStatus,
    admit: () => admission,
  });
}

beforeAll(() => {
  setEngines({ stt: fakeStt });
  server = startServer();
});
beforeEach(() => {
  resetFake();
  warnSpy.mockClear();
});
afterEach(() => {
  setGuardHandle(null);
  for (const k of ['RT_MAX_SESSIONS', 'RT_IDLE_TIMEOUT_SEC', 'RT_MAX_SESSION_SEC'])
    delete process.env[k];
});
afterAll(() => {
  server.stop(true);
  setEngines({ stt: undefined });
  for (const s of spies) s.mockRestore();
  warnSpy.mockRestore();
});

const until = async (ok: () => boolean) => {
  for (let i = 0; i < 300 && !ok(); i++) await Bun.sleep(5);
  expect(ok()).toBe(true);
};

describe('before the upgrade', () => {
  test('unauthenticated upgrade is rejected with 401, OpenAI-shaped', async () => {
    const res = (await upgradeRequest()) as Response;
    expect(res.status).toBe(401);
    expect((await res.json()).error.type).toBe('authentication_error');
    expect(refusals()).toEqual([
      { requestId: expect.any(String), code: 'invalid_api_key', status: 401 },
    ]);
  });

  test('plain GET without Upgrade gets 426', async () => {
    const res = await api.handle(
      new Request('http://localhost/api/v1/realtime', { headers: AUTH }),
    );
    expect(res.status).toBe(426);
    expect((await res.json()).error.code).toBe('upgrade_required');
  });

  test('cookie session from a foreign Origin is refused (CSWSH)', async () => {
    const res = (await upgradeRequest({ ...AUTH, origin: 'https://evil.example' })) as Response;
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('origin_not_allowed');
  });

  test('memory guard refusal → 503 memory_pressure + Retry-After', async () => {
    guard('normal', { ok: false, reason: 'pressure', retryAfterSec: 12 });
    const res = (await upgradeRequest(AUTH)) as Response;
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('12');
    expect((await res.json()).error.code).toBe('memory_pressure');
    expect(refusals()).toEqual([
      expect.objectContaining({ code: 'memory_pressure', status: 503, reason: 'pressure' }),
    ]);
  });

  test('engine not registered → 503 engine_unavailable', async () => {
    setEngines({ stt: undefined });
    const res = (await upgradeRequest(AUTH)) as Response;
    setEngines({ stt: fakeStt });
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('engine_unavailable');
  });

  test('session limit → 429 too_many_sessions; slot frees on close', async () => {
    process.env.RT_MAX_SESSIONS = '1';
    const c = connect(server.port as number);
    await c.opened;
    expect(realtimeActiveSessions()).toBe(1);
    const res = (await upgradeRequest(AUTH)) as Response;
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe('too_many_sessions');
    expect(refusals()).toEqual([
      { requestId: expect.any(String), code: 'too_many_sessions', status: 429, active: 1, max: 1 },
    ]);
    c.ws.close();
    await until(() => realtimeActiveSessions() === 0);
    expect(await upgradeRequest(AUTH)).toBeUndefined();
    await until(() => realtimeActiveSessions() === 1);
    // the fake upgrader never opens a socket: give the slot back by hand
    releaseRealtimeSlot();
  });

  test('failed upgrade releases the slot', async () => {
    const res = (await upgradeRequest(AUTH, false)) as Response;
    expect(res.status).toBe(400);
    expect(realtimeActiveSessions()).toBe(0);
  });
});

describe('after the upgrade', () => {
  test('?intent other than transcription → error event, then close 1008', async () => {
    const c = connect(server.port as number, '?intent=realtime');
    await c.opened;
    const e = await c.next('error');
    expect(e.error).toMatchObject({
      type: 'invalid_request_error',
      code: 'unsupported_session_type',
      param: 'intent',
    });
    expect(await c.closed()).toBe(1008);
  });

  test('?intent=transcription is accepted', async () => {
    const c = connect(server.port as number, '?intent=transcription');
    await c.opened;
    await c.next('session.created');
    c.ws.close();
  });

  test('idle timeout → error idle_timeout, then close 1008', async () => {
    process.env.RT_IDLE_TIMEOUT_SEC = '0.15';
    const c = connect(server.port as number);
    await c.opened;
    expect((await c.next('error')).error.code).toBe('idle_timeout');
    expect(await c.closed()).toBe(1008);
    await until(() => realtimeActiveSessions() === 0);
  });

  test('session lifetime cap → session_expired, then close 1008', async () => {
    process.env.RT_MAX_SESSION_SEC = '0.15';
    const c = connect(server.port as number);
    await c.opened;
    expect((await c.next('error')).error.code).toBe('session_expired');
    expect(await c.closed()).toBe(1008);
  });

  test('guard emergency during a turn → failed + error, then close 1013', async () => {
    const c = connect(server.port as number);
    await c.opened;
    await c.next('session.created');
    guard('emergency');
    for (const audio of pcmChunks(200, 0.3)) c.send({ type: 'input_audio_buffer.append', audio });
    c.send({ type: 'input_audio_buffer.commit' });
    expect((await c.next('conversation.item.input_audio_transcription.failed')).error.code).toBe(
      'memory_pressure',
    );
    expect((await c.next('error')).error).toMatchObject({
      type: 'server_error',
      code: 'memory_pressure',
    });
    expect(await c.closed()).toBe(1013);
    expect(fakeStt.last).toBeNull();
  });

  test('close mid-turn aborts the engine job and releases the slot', async () => {
    fakeStt.mode = 'hang-after-delta';
    const c = connect(server.port as number);
    await c.opened;
    for (const audio of pcmChunks(300, 0.3)) c.send({ type: 'input_audio_buffer.append', audio });
    c.send({ type: 'input_audio_buffer.commit' });
    await until(() => fakeStt.last !== null);
    c.ws.close();
    await until(() => fakeStt.aborted && realtimeActiveSessions() === 0);
  });
});
