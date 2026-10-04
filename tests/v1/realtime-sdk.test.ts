/** Compatibility proof: the unmodified openai SDK OpenAIRealtimeWS (Node `ws`) against our server. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import OpenAI from 'openai';
import { OpenAIRealtimeWS } from 'openai/realtime/ws';
import { setEngines } from '../../server/engines/registry';
import { fakeStt, resetFake, SESSION_TOKEN, stubSession, TRANSCRIPT } from './fake-stt';
import { type Ev, pcmChunks, setFakeVad, startServer } from './realtime-harness';

const spies = stubSession();
// The SDK always dials wss://, so the test server needs a throwaway self-signed cert.
const dir = mkdtempSync(path.join(tmpdir(), 'rt-sdk-'));
const cert = path.join(dir, 'c.pem');
const key = path.join(dir, 'k.pem');
let server: ReturnType<typeof startServer>;

beforeAll(() => {
  const r = Bun.spawnSync(
    [
      'openssl',
      'req',
      '-x509',
      '-newkey',
      'ec',
      '-pkeyopt',
      'ec_paramgen_curve:prime256v1',
      '-nodes',
      '-keyout',
      key,
      '-out',
      cert,
      '-days',
      '1',
      '-subj',
      '/CN=127.0.0.1',
      '-addext',
      'subjectAltName=IP:127.0.0.1',
    ],
    { stderr: 'pipe' },
  );
  if (r.exitCode !== 0) throw new Error(`openssl failed: ${r.stderr.toString()}`);
  resetFake();
  setFakeVad(true);
  setEngines({ stt: fakeStt });
  server = startServer({ cert, key });
});
afterAll(() => {
  server.stop(true);
  setFakeVad(false);
  setEngines({ stt: undefined });
  for (const s of spies) s.mockRestore();
  rmSync(dir, { recursive: true, force: true });
});

test('OpenAIRealtimeWS: manual commit and a server_vad turn', async () => {
  const client = new OpenAI({
    apiKey: SESSION_TOKEN,
    baseURL: `https://127.0.0.1:${server.port}/api/v1`,
  });
  const rt = new OpenAIRealtimeWS(
    {
      intent: 'transcription',
      options: { tls: { ca: [await Bun.file(cert).text()] } },
    } as unknown as ConstructorParameters<typeof OpenAIRealtimeWS>[0],
    client,
  );
  const events: Ev[] = [];
  const errors: unknown[] = [];
  rt.on('event', (e) => events.push(e as Ev));
  rt.on('error', (e) => errors.push(e));
  const wait = async (type: string, n = 1) => {
    for (let i = 0; i < 600; i++) {
      const hit = events.filter((e) => e.type === type)[n - 1];
      if (hit) return hit;
      await Bun.sleep(5);
    }
    throw new Error(`no ${type} #${n}: ${events.map((e) => e.type).join(',')}`);
  };

  await new Promise((res, rej) => {
    rt.socket.once('open', res);
    rt.socket.once('error', rej);
  });
  await wait('session.created');
  const append = (ms: number, amp: number) => {
    for (const audio of pcmChunks(ms, amp)) rt.send({ type: 'input_audio_buffer.append', audio });
  };
  rt.send({
    type: 'session.update',
    session: {
      type: 'transcription',
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 24_000 },
          transcription: { model: 'gpt-4o-mini-transcribe', language: 'id' },
          turn_detection: null,
        },
      },
    },
  });
  await wait('session.updated');
  append(400, 0.4);
  rt.send({ type: 'input_audio_buffer.commit' });
  const manual = await wait('conversation.item.input_audio_transcription.completed');
  expect(manual.transcript).toBe(TRANSCRIPT.text);
  expect(fakeStt.last?.language).toBe('id');

  rt.send({
    type: 'session.update',
    session: {
      type: 'transcription',
      audio: { input: { turn_detection: { type: 'server_vad', silence_duration_ms: 300 } } },
    },
  });
  await wait('session.updated', 2);
  append(400, 0);
  append(800, 0.4);
  append(800, 0);
  const started = await wait('input_audio_buffer.speech_started');
  const vadTurn = await wait('conversation.item.input_audio_transcription.completed', 2);
  expect(vadTurn.item_id).toBe(started.item_id);
  expect((await wait('input_audio_buffer.committed', 2)).previous_item_id).toBe(manual.item_id);
  expect(errors).toEqual([]);
  rt.close();
  await new Promise((res) => rt.socket.once('close', res));
});
