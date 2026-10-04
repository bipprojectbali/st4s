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

type Probe = Float32Array | 'error' | 'hang';
type FakeChild = { sent: ParentMsg[]; killed: boolean; crash(): void };

/** Fake child: loads at once; the probe (id < 0) gets `probes[i]` (child i, last one repeats) after `probeDelayMs`, real jobs a 1 s tone. */
function fakeSpawner(probes: Probe | Probe[], probeDelayMs = 0) {
  const children: FakeChild[] = [];
  const spawn: Spawner = ({ onMessage, onExit }) => {
    const list = Array.isArray(probes) ? probes : [probes];
    const probe = list[Math.min(children.length, list.length - 1)];
    const c: FakeChild = {
      sent: [],
      killed: false,
      crash: () => onExit(1, null),
    };
    children.push(c);
    const reply = (m: ChildMsg) => queueMicrotask(() => onMessage(m));
    return {
      exited: Promise.resolve(),
      send(m) {
        c.sent.push(m);
        if (m.type === 'load')
          return reply({ type: 'loaded', sampleRate: RATE, loadMs: 3, rss: 1 });
        if (m.id >= 0) return reply({ type: 'result', id: m.id, pcm: tone(1), rss: 2 });
        if (probe === 'hang') return;
        const msg: ChildMsg =
          probe === 'error'
            ? { type: 'error', id: m.id, message: 'onnx exploded', rss: 2 }
            : { type: 'result', id: m.id, pcm: probe ?? tone(1.5), rss: 2 };
        if (probeDelayMs) setTimeout(() => onMessage(msg), probeDelayMs);
        else reply(msg);
      },
      kill() {
        c.killed = true;
        queueMicrotask(() => onExit(null, 'SIGTERM'));
      },
    };
  };
  return { spawn, children };
}

const make = (probe: Probe | Probe[], selfTest = true, probeDelayMs = 0) => {
  const f = fakeSpawner(probe, probeDelayMs);
  const eng = createTtsEngine({
    spawn: f.spawn,
    selfTest,
    config: { modelDir, idleTimeoutSec: 0 },
  });
  return { f, eng };
};

/** Runs `fn` with ENGINE_SELFTEST_TIMEOUT_SEC set, restoring the previous value. */
async function withTimeout(sec: string, fn: () => Promise<void>) {
  const prev = process.env.ENGINE_SELFTEST_TIMEOUT_SEC;
  process.env.ENGINE_SELFTEST_TIMEOUT_SEC = sec;
  try {
    await fn();
  } finally {
    if (prev === undefined) delete process.env.ENGINE_SELFTEST_TIMEOUT_SEC;
    else process.env.ENGINE_SELFTEST_TIMEOUT_SEC = prev;
  }
}

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

  test('a child that never answers the probe → timeout reason, state error, child killed', () =>
    withTimeout('0.05', async () => {
      const { f, eng } = make('hang');
      const err = await eng.warmup().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(EngineNotReadyError);
      expect(eng.status().state).toBe('error');
      expect(eng.status().lastError).toContain('Self-test TTS tidak selesai dalam 0.05 dtk');
      expect(f.children[0]?.killed).toBe(true);
    }));

  test("a crashed child's timer firing during the next load does not fail that load", () =>
    withTimeout('0.2', async () => {
      // Child 1 crashes at ~100 ms; child 2 answers ~150 ms later (~250 ms): after child 1's
      // deadline (~200 ms) fires, before its own (~300 ms).
      const { f, eng } = make(['hang', tone(1.5)], true, 150);
      const first = eng.warmup().catch((e: unknown) => e);
      await Bun.sleep(100);
      f.children[0]?.crash();
      expect(await first).toBeInstanceOf(Error);
      await eng.warmup();
      expect(f.children.length).toBe(2);
      expect(eng.status().state).toBe('ready');
      expect(eng.status().lastError ?? '').not.toContain('tidak selesai');
    }));
});
