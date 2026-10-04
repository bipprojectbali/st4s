import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EngineNotReadyError } from '../../server/engines/errors';
import { createTtsEngine } from '../../server/engines/tts';
import type { ChildMsg, ParentMsg } from '../../server/engines/tts/protocol';
import { checkTtsAudio, TTS_SELFTEST_TEXT } from '../../server/engines/tts/selftest';
import type { Spawner } from '../../server/engines/tts/spawner';

const RATE = 1000;
const modelDir = fs.mkdtempSync(path.join(os.tmpdir(), 's4s-tts-selftest-'));
fs.mkdirSync(path.join(modelDir, 'onnx'));
fs.mkdirSync(path.join(modelDir, 'voice_styles'));
fs.writeFileSync(
  path.join(modelDir, 'onnx', 'tts.json'),
  JSON.stringify({ ae: { sample_rate: RATE } }),
);
for (const v of ['M1', 'F1'])
  fs.writeFileSync(path.join(modelDir, 'voice_styles', `${v}.json`), '{}');
afterAll(() => fs.rmSync(modelDir, { recursive: true, force: true }));

const tone = (sec: number, amp = 0.2) =>
  new Float32Array(Math.round(sec * RATE)).map((_, i) => amp * Math.sin(i / 3));

/** Fake child: loads at once; the probe (id < 0) gets `probe`, real jobs get a 1 s tone. */
function fakeSpawner(probe: Float32Array | 'error') {
  const children: { sent: ParentMsg[]; killed: boolean }[] = [];
  const spawn: Spawner = ({ onMessage, onExit }) => {
    const c = { sent: [] as ParentMsg[], killed: false };
    children.push(c);
    const reply = (m: ChildMsg) => queueMicrotask(() => onMessage(m));
    return {
      exited: Promise.resolve(),
      send(m) {
        c.sent.push(m);
        if (m.type === 'load')
          return reply({ type: 'loaded', sampleRate: RATE, loadMs: 3, rss: 1 });
        if (m.id >= 0) return reply({ type: 'result', id: m.id, pcm: tone(1), rss: 2 });
        reply(
          probe === 'error'
            ? { type: 'error', id: m.id, message: 'onnx exploded', rss: 2 }
            : { type: 'result', id: m.id, pcm: probe, rss: 2 },
        );
      },
      kill() {
        c.killed = true;
        queueMicrotask(() => onExit(null, 'SIGTERM'));
      },
    };
  };
  return { spawn, children };
}

const make = (probe: Float32Array | 'error', selfTest = true) => {
  const f = fakeSpawner(probe);
  const eng = createTtsEngine({
    spawn: f.spawn,
    selfTest,
    config: { modelDir, idleTimeoutSec: 0 },
  });
  return { f, eng };
};

const req = { text: 'Halo.', voice: 'M1', language: 'id', speed: 1 };

describe('checkTtsAudio', () => {
  test('accepts speech-like audio of plausible length', () => {
    expect(checkTtsAudio(tone(1.5), RATE).reason).toBeNull();
  });

  test.each([
    ['empty', new Float32Array(0), 'kosong'],
    ['NaN', tone(1.5).fill(Number.NaN, 10, 20), 'NaN'],
    ['silent', new Float32Array(1500), 'hening'],
    ['too short', tone(0.1), 'durasi'],
    ['too long', tone(30), 'durasi'],
  ])('rejects %s audio', (_name, pcm, word) => {
    const { reason } = checkTtsAudio(pcm, RATE);
    expect(reason).toContain('Self-test TTS gagal');
    expect(reason).toContain(word);
    expect(reason).toContain('TTS_MODEL_DIR');
  });
});

describe('tts engine self-test (fake child)', () => {
  test('passing probe → ready; probe is the fixed phrase with the first voice', async () => {
    const { f, eng } = make(tone(1.5));
    await eng.warmup();
    expect(eng.status().state).toBe('ready');
    expect(eng.status().loadedAt).not.toBeNull();
    expect(f.children[0]?.sent[1]).toMatchObject({
      type: 'synth',
      id: -1,
      text: TTS_SELFTEST_TEXT,
      voice: 'F1',
      speed: 1,
    });
    expect((await eng.synthesize(req)).length).toBe(RATE);
  });

  test.each([
    ['silent', new Float32Array(1500), 'hening'],
    ['NaN', tone(1.5).fill(Number.NaN), 'NaN'],
    ['empty', new Float32Array(0), 'kosong'],
    ['erroring', 'error' as const, 'sintesis frasa uji error'],
  ])(
    '%s probe → error, child killed, requests get EngineNotReadyError',
    async (_n, probe, word) => {
      const { f, eng } = make(probe);
      const err = await eng.synthesize(req).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(EngineNotReadyError);
      expect((err as Error).message).toContain('gagal dimuat');
      const s = eng.status();
      expect(s.state).toBe('error');
      expect(s.loadedAt).toBeNull();
      expect(s.lastError).toContain(word);
      expect(f.children[0]?.killed).toBe(true);
    },
  );

  test('selfTest: false → ready without a probe', async () => {
    const { f, eng } = make(new Float32Array(0), false);
    await eng.warmup();
    expect(eng.status().state).toBe('ready');
    expect(f.children[0]?.sent.map((m) => m.type)).toEqual(['load']);
  });
});
