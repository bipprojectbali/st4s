/** VAD failure → 500 `vad_failed` on HTTP (json/text/stream before and after a delta) and on realtime turns. */
import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { VAD_FAILED_MESSAGE, VadFailedError } from '../../server/engines/errors';
import { setEngines } from '../../server/engines/registry';
import { v1ErrorBody } from '../../server/v1/errors';
import { call, fakeStt, form, resetFake, SESSION_TOKEN, stubSession } from './fake-stt';
import { connect, pcmChunks, setFakeVad, startServer } from './realtime-harness';
import { makeWav } from './wav-fixture';

const DETAIL = 'STT VAD failed on silero.bin (1.2s audio); check STT_VAD_MODEL';
const wav = makeWav({ sampleRate: 16_000, channels: 1, bits: 16, frames: 19_200 });
const VAD_BODY = v1ErrorBody(500, VAD_FAILED_MESSAGE, 'vad_failed');

let failAfterDelta = false;
const spies = stubSession();
const transcribe = spyOn(fakeStt, 'transcribe').mockImplementation(async (req) => {
  if (fakeStt.mode === 'boom') throw new Error('child process exploded at /secret/path');
  if (failAfterDelta) {
    req.onDelta?.('Halo');
    await Bun.sleep(1);
  }
  throw new VadFailedError(DETAIL);
});
let server: ReturnType<typeof startServer>;

beforeAll(() => {
  setEngines({ stt: fakeStt });
  server = startServer();
});
beforeEach(() => {
  resetFake();
  setFakeVad(false);
  failAfterDelta = false;
});
afterAll(() => {
  server.stop(true);
  setFakeVad(false);
  transcribe.mockRestore();
  for (const s of spies) s.mockRestore();
  setEngines({ stt: null });
});

const post = (fields: Record<string, string>) =>
  call('/api/v1/audio/transcriptions', {
    method: 'POST',
    headers: { authorization: `Bearer ${SESSION_TOKEN}` },
    body: form({ model: 'gpt-4o-mini-transcribe', ...fields }, wav),
  });

describe('HTTP /api/v1/audio/transcriptions', () => {
  test('json and text → 500 vad_failed, generic message, no path or detail', async () => {
    for (const response_format of ['json', 'text']) {
      const res = await post({ response_format });
      expect(res.status).toBe(500);
      expect(res.headers.get('x-request-id')).toBeTruthy();
      const body = await res.json();
      expect(body).toEqual(VAD_BODY);
      expect(JSON.stringify(body)).not.toContain('silero');
    }
  });

  test('stream, failure before the first delta → plain 500 vad_failed JSON', async () => {
    const res = await post({ stream: 'true' });
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.json()).toEqual(VAD_BODY);
  });

  test('stream, failure after a delta → SSE error event with code vad_failed', async () => {
    failAfterDelta = true;
    const res = await post({ stream: 'true' });
    expect(res.status).toBe(200);
    const events = (await res.text())
      .split('\n\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l.replace(/^data: /, '')));
    expect(events).toEqual([
      { type: 'transcript.text.delta', delta: 'Halo' },
      { type: 'error', ...VAD_BODY },
    ]);
  });

  test('other engine errors still answer 500 server_error', async () => {
    fakeStt.mode = 'boom';
    const res = await post({});
    expect(res.status).toBe(500);
    const body = (await res.json()) as ReturnType<typeof v1ErrorBody>;
    expect(body.error.code).toBe('server_error');
    expect(body.error.message).not.toContain('/secret/path');
  });
});

describe('realtime', () => {
  async function open() {
    const c = connect(server.port as number);
    await c.opened;
    await c.next('session.created');
    return c;
  }

  test('a turn whose transcription hits a VAD failure → .failed with code vad_failed', async () => {
    const c = await open();
    for (const audio of pcmChunks(200, 0.3)) c.send({ type: 'input_audio_buffer.append', audio });
    c.send({ type: 'input_audio_buffer.commit' });
    const f = await c.next('conversation.item.input_audio_transcription.failed');
    expect(f.error).toEqual({
      type: 'server_error',
      code: 'vad_failed',
      message: VAD_FAILED_MESSAGE,
      param: null,
    });
    expect(c.closeCode).toBeNull();
    c.ws.close();
  });

  test('server_vad failure keeps its vad_failed error event and falls back to manual commit', async () => {
    setFakeVad(true);
    const f = fakeStt as typeof fakeStt & { vad?: unknown };
    f.vad = async () => {
      throw new Error('STT VAD failed: crispasr_vad_slices failed on /models/silero.bin');
    };
    const c = await open();
    for (const audio of pcmChunks(600, 0.4)) c.send({ type: 'input_audio_buffer.append', audio });
    const e = await c.next('error');
    expect(e.error.code).toBe('vad_failed');
    expect(e.error.message).not.toContain('silero');
    expect((await c.next('session.updated')).session.audio.input.turn_detection).toBeNull();
    c.ws.close();
  });
});
