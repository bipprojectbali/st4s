// Real-model probe; run only under the model lock: S4S_REAL_ENGINE=1 NODE_ENV=test bun test tests/engines/tts-real.test.ts
import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { createTtsEngine } from '../../server/engines/tts';

const enabled = process.env.S4S_REAL_ENGINE === '1';
const PROBE_WAV = '/tmp/s4s-tts-probe.wav';
const TEXT =
  'Halo, selamat pagi. Hari ini kita menguji suara bahasa Indonesia dengan Supertonic tiga.';

function wav16(pcm: Float32Array, sampleRate: number): Buffer {
  const buf = Buffer.alloc(44 + pcm.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + pcm.length * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(pcm.length * 2, 40);
  for (let i = 0; i < pcm.length; i++)
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, pcm[i])) * 32767), 44 + i * 2);
  return buf;
}

describe.skipIf(!enabled)('tts real model (Supertonic 3)', () => {
  const engine = createTtsEngine({ config: { idleTimeoutSec: 0 } });
  afterAll(() => engine.unload());

  test('loads, synthesizes Indonesian, handles <laugh>', async () => {
    let t = performance.now();
    await engine.warmup();
    const loadMs = performance.now() - t;
    expect(engine.voices()).toEqual(['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5']);

    t = performance.now();
    const pcm = await engine.synthesize({ text: TEXT, voice: 'F1', language: 'id', speed: 1 });
    const synthMs = performance.now() - t;
    const audioSec = pcm.length / engine.sampleRate;
    fs.writeFileSync(PROBE_WAV, wav16(pcm, engine.sampleRate));
    expect(audioSec).toBeGreaterThan(2);
    expect(pcm.some((s) => Math.abs(s) > 0.01)).toBe(true);

    t = performance.now();
    const laugh = await engine.synthesize({
      text: 'Itu lucu sekali <laugh> aku tidak bisa berhenti tertawa.',
      voice: 'M1',
      language: 'id',
      speed: 1,
    });
    const laughMs = performance.now() - t;
    expect(laugh.length).toBeGreaterThan(0);

    const s = engine.status();
    console.log(
      JSON.stringify({
        loadMs: Math.round(loadMs),
        synthMs: Math.round(synthMs),
        audioSec: +audioSec.toFixed(2),
        rtf: +(synthMs / 1000 / audioSec).toFixed(3),
        laughMs: Math.round(laughMs),
        laughAudioSec: +(laugh.length / engine.sampleRate).toFixed(2),
        childRssMB: Math.round((s.rssBytes ?? 0) / 1048576),
        sampleRate: engine.sampleRate,
        stats: s.stats,
      }),
    );
  }, 240_000);
});
