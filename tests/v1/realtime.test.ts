import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { EngineNotReadyError } from '../../server/engines/errors';
import { setEngines } from '../../server/engines/registry';
import { fakeStt, NOT_READY_DETAIL, resetFake, stubSession, TRANSCRIPT } from './fake-stt';
import {
  connect,
  pcmChunks,
  setFakeVad,
  startServer,
  transcriptionUpdate,
} from './realtime-harness';

const spies = stubSession();
let server: ReturnType<typeof startServer>;

beforeAll(() => {
  setEngines({ stt: fakeStt });
  server = startServer();
});
beforeEach(() => {
  resetFake();
  setFakeVad(false);
});
afterAll(() => {
  server.stop(true);
  setFakeVad(false);
  setEngines({ stt: undefined });
  for (const s of spies) s.mockRestore();
  delete process.env.RT_MAX_TURN_SEC;
});

async function open(query = '') {
  const c = connect(server.port as number, query);
  await c.opened;
  await c.next('session.created');
  return c;
}
const appendAll = (c: Awaited<ReturnType<typeof open>>, chunks: string[]) => {
  for (const audio of chunks) c.send({ type: 'input_audio_buffer.append', audio });
};

describe('session', () => {
  test('session.created describes a transcription session; manual commit when no VAD', async () => {
    const c = await open();
    const s = c.events[0];
    expect(s.event_id).toMatch(/^event_/);
    expect(s.session.type).toBe('transcription');
    expect(s.session.audio.input.format).toEqual({ type: 'audio/pcm', rate: 24_000 });
    expect(s.session.audio.input.turn_detection).toBeNull();
    c.ws.close();
  });

  test('session.update validation answers with OpenAI-shaped errors and keeps the session', async () => {
    const c = await open();
    const bad = [
      [{ type: 'session.update', session: { type: 'realtime' } }, 'unsupported_session_type'],
      [
        {
          type: 'session.update',
          event_id: 'e1',
          session: {
            type: 'transcription',
            audio: { input: { format: { type: 'audio/pcm', rate: 16000 } } },
          },
        },
        'unsupported_audio_format',
      ],
      [transcriptionUpdate(null, { model: 'nope-1' }), 'model_not_found'],
      [transcriptionUpdate(null, { language: 'indonesian' }), 'invalid_value'],
      [transcriptionUpdate({ type: 'server_vad' }), 'vad_unavailable'],
      [transcriptionUpdate({ type: 'semantic_vad' }), 'unsupported_turn_detection'],
    ] as const;
    for (const [ev] of bad) c.send(ev);
    for (let i = 0; i < bad.length; i++) {
      const e = await c.next('error', i + 1);
      expect(e.error.type).toBe('invalid_request_error');
      expect(e.error.code).toBe(bad[i][1]);
    }
    expect((await c.next('error', 2)).error.event_id).toBe('e1');
    c.send(transcriptionUpdate(null, { model: 'gpt-4o-transcribe', prompt: 'Makuro' }));
    const u = await c.next('session.updated');
    expect(u.session.audio.input.transcription.language).toBe('id');
    expect(c.closeCode).toBeNull();
    c.ws.close();
  });

  test('unknown events, bad JSON and binary frames are errors, not disconnects', async () => {
    const c = await open();
    c.send({ type: 'response.create' });
    c.ws.send('{nope');
    c.ws.send(new Uint8Array([1, 2, 3]));
    expect((await c.next('error', 1)).error.code).toBe('unsupported_event');
    expect((await c.next('error', 2)).error.code).toBe('invalid_json');
    expect((await c.next('error', 3)).error.code).toBe('invalid_event');
    expect(c.closeCode).toBeNull();
    c.ws.close();
  });
});

describe('manual turns', () => {
  test('commit → committed, item.added, one delta with the full text, completed; ids chain', async () => {
    const c = await open();
    appendAll(c, pcmChunks(500, 0.3));
    c.send({ type: 'input_audio_buffer.commit' });
    const done1 = await c.next('conversation.item.input_audio_transcription.completed');
    appendAll(c, pcmChunks(300, 0.3));
    c.send({ type: 'input_audio_buffer.commit' });
    const done2 = await c.next('conversation.item.input_audio_transcription.completed', 2);

    const [c1, c2] = c.events.filter((e) => e.type === 'input_audio_buffer.committed');
    expect(c1.previous_item_id).toBeNull();
    expect(c2.previous_item_id).toBe(c1.item_id);
    const added = c.events.find((e) => e.type === 'conversation.item.added');
    expect(added?.item.id).toBe(c1.item_id);
    const deltas = c.events.filter(
      (e) => e.type === 'conversation.item.input_audio_transcription.delta',
    );
    expect(deltas.map((d) => d.delta)).toEqual([TRANSCRIPT.text, TRANSCRIPT.text]);
    expect(done1.item_id).toBe(c1.item_id);
    expect(done1.transcript).toBe(TRANSCRIPT.text);
    expect(done1.usage).toEqual({ type: 'duration', seconds: 1 });
    expect(done2.item_id).toBe(c2.item_id);

    const order = c.types().slice(0, 5);
    expect(order).toEqual([
      'session.created',
      'input_audio_buffer.committed',
      'conversation.item.added',
      'conversation.item.input_audio_transcription.delta',
      'conversation.item.input_audio_transcription.completed',
    ]);
    // 500 ms at 24 kHz reaches the engine as 16 kHz float.
    expect(fakeStt.last?.audio.length).toBeGreaterThan(4_400);
    expect(fakeStt.last?.audio.length).toBeLessThan(4_900);
    expect(fakeStt.last?.language).toBe(undefined);
    c.ws.close();
  });

  test('a silent turn (engine returns empty text) → completed with transcript "" and no delta', async () => {
    const silent = spyOn(fakeStt, 'transcribe').mockResolvedValueOnce({
      text: '',
      segments: [],
      duration: 0.3,
      language: 'unknown',
    });
    const c = await open();
    appendAll(c, pcmChunks(300, 0));
    c.send({ type: 'input_audio_buffer.commit' });
    const done = await c.next('conversation.item.input_audio_transcription.completed');
    silent.mockRestore();
    expect(done.transcript).toBe('');
    expect(c.types()).not.toContain('conversation.item.input_audio_transcription.delta');
    expect(c.types()).not.toContain('conversation.item.input_audio_transcription.failed');
    c.ws.close();
  });

  test('clear empties the buffer; empty commit is an error', async () => {
    const c = await open();
    appendAll(c, pcmChunks(300, 0.3));
    c.send({ type: 'input_audio_buffer.clear' });
    await c.next('input_audio_buffer.cleared');
    c.send({ type: 'input_audio_buffer.commit' });
    expect((await c.next('error')).error.code).toBe('input_audio_buffer_commit_empty');
    expect(fakeStt.last).toBeNull();
    c.ws.close();
  });

  test('bad base64 and odd byte counts are rejected; the session keeps working', async () => {
    const c = await open();
    c.send({ type: 'input_audio_buffer.append', audio: '***' });
    c.send({ type: 'input_audio_buffer.append', audio: Buffer.from([1, 2, 3]).toString('base64') });
    c.send({ type: 'input_audio_buffer.append', audio: 42 });
    expect((await c.next('error', 1)).error.code).toBe('invalid_audio');
    expect((await c.next('error', 2)).error.message).toContain('genap');
    expect((await c.next('error', 3)).error.code).toBe('invalid_value');
    appendAll(c, pcmChunks(200, 0.3));
    c.send({ type: 'input_audio_buffer.commit' });
    await c.next('conversation.item.input_audio_transcription.completed');
    c.ws.close();
  });

  test('turn overflow without VAD: error + cleared', async () => {
    process.env.RT_MAX_TURN_SEC = '0.5';
    const c = await open();
    appendAll(c, pcmChunks(700, 0.3));
    expect((await c.next('error')).error.code).toBe('turn_too_long');
    await c.next('input_audio_buffer.cleared');
    expect(fakeStt.last).toBeNull();
    delete process.env.RT_MAX_TURN_SEC;
    c.ws.close();
  });

  test('engine failures become .failed and the session stays open', async () => {
    const c = await open();
    const turn = async (n: number) => {
      appendAll(c, pcmChunks(200, 0.3));
      c.send({ type: 'input_audio_buffer.commit' });
      return c.next('conversation.item.input_audio_transcription.failed', n);
    };
    fakeStt.mode = 'boom';
    const f1 = await turn(1);
    expect(f1.error.code).toBe('server_error');
    expect(f1.error.message).not.toContain('/secret/path');
    fakeStt.mode = 'busy';
    expect((await turn(2)).error.code).toBe('engine_busy');
    fakeStt.mode = 'unloaded';
    expect((await turn(3)).error.code).toBe('engine_unloaded');
    fakeStt.mode = 'not-ready';
    const f4 = await turn(4);
    expect(f4.error).toMatchObject({ code: 'engine_unavailable', type: 'server_error' });
    expect(f4.error.message).toContain('gagal dimuat');
    expect(f4.error.message).not.toContain(NOT_READY_DETAIL);
    fakeStt.mode = 'ok';
    fakeStt.queued = 99;
    expect((await turn(5)).error).toMatchObject({ code: 'engine_busy', type: 'rate_limit_error' });
    fakeStt.queued = 0;
    appendAll(c, pcmChunks(200, 0.3));
    c.send({ type: 'input_audio_buffer.commit' });
    await c.next('conversation.item.input_audio_transcription.completed');
    expect(c.closeCode).toBeNull();
    c.ws.close();
  });
});

describe('server_vad', () => {
  test('defaults to server_vad when the engine has VAD; speech → started/stopped/committed', async () => {
    setFakeVad(true);
    const c = await open();
    expect(c.events[0].session.audio.input.turn_detection).toEqual({
      type: 'server_vad',
      threshold: 0.5,
      prefix_padding_ms: 300,
      silence_duration_ms: 500,
    });
    c.send(transcriptionUpdate({ type: 'server_vad' }));
    await c.next('session.updated');
    appendAll(c, [...pcmChunks(600, 0), ...pcmChunks(1000, 0.4), ...pcmChunks(1200, 0)]);
    const started = await c.next('input_audio_buffer.speech_started');
    const stopped = await c.next('input_audio_buffer.speech_stopped');
    const committed = await c.next('input_audio_buffer.committed');
    const done = await c.next('conversation.item.input_audio_transcription.completed');
    expect(stopped.item_id).toBe(started.item_id);
    expect(committed.item_id).toBe(started.item_id);
    expect(done.item_id).toBe(started.item_id);
    expect(started.audio_start_ms).toBeGreaterThanOrEqual(250);
    expect(started.audio_start_ms).toBeLessThanOrEqual(350);
    expect(stopped.audio_end_ms).toBeGreaterThanOrEqual(2000);
    expect(stopped.audio_end_ms).toBeLessThanOrEqual(2200);
    // turn = 300 ms prefix + 1 s speech + 500 ms silence
    expect(fakeStt.last?.audio.length).toBeGreaterThan(16_000 * 1.6);
    expect(fakeStt.last?.audio.length).toBeLessThan(16_000 * 2);
    c.ws.close();
  });

  test('turn overflow with VAD auto-commits', async () => {
    setFakeVad(true);
    process.env.RT_MAX_TURN_SEC = '0.5';
    const c = await open();
    appendAll(c, pcmChunks(700, 0.4));
    const committed = await c.next('input_audio_buffer.committed');
    expect((await c.next('input_audio_buffer.speech_stopped')).item_id).toBe(committed.item_id);
    expect(c.events.some((e) => e.type === 'error')).toBe(false);
    delete process.env.RT_MAX_TURN_SEC;
    c.ws.close();
  });

  test('VAD on a not-ready engine → engine_unavailable error, then manual commit', async () => {
    setFakeVad(true);
    const f = fakeStt as typeof fakeStt & { vad?: unknown };
    f.vad = async () => {
      throw new EngineNotReadyError('stt', NOT_READY_DETAIL);
    };
    const c = await open();
    appendAll(c, pcmChunks(600, 0.4));
    const e = await c.next('error');
    expect(e.error).toMatchObject({ code: 'engine_unavailable', type: 'server_error' });
    expect(e.error.message).toContain('gagal dimuat');
    expect(e.error.message).not.toContain(NOT_READY_DETAIL);
    expect((await c.next('session.updated')).session.audio.input.turn_detection).toBeNull();
    expect(c.closeCode).toBeNull();
    c.ws.close();
  });

  test('turn_detection null switches to manual commit', async () => {
    setFakeVad(true);
    const c = await open();
    c.send(transcriptionUpdate(null));
    expect((await c.next('session.updated')).session.audio.input.turn_detection).toBeNull();
    appendAll(c, [...pcmChunks(800, 0.4), ...pcmChunks(800, 0)]);
    await Bun.sleep(50);
    expect(c.types()).not.toContain('input_audio_buffer.speech_started');
    c.ws.close();
  });
});
