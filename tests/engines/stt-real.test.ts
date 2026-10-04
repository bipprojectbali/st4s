import { expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { createSttEngine } from '../../server/engines/stt';

const REAL = process.env.S4S_REAL_ENGINE === '1';
const WAV = process.env.STT_TEST_WAV ?? path.join(os.homedir(), 'tmp/stt/audio.wav');

/** Minimal RIFF/WAVE PCM16 reader → 16 kHz mono Float32 (linear resample, channel mixdown). */
function readWav16k(buf: ArrayBuffer): Float32Array {
  const v = new DataView(buf);
  let off = 12;
  let ch = 1;
  let sr = 16_000;
  let bits = 16;
  while (off + 8 <= v.byteLength) {
    const id = String.fromCharCode(
      v.getUint8(off),
      v.getUint8(off + 1),
      v.getUint8(off + 2),
      v.getUint8(off + 3),
    );
    const size = v.getUint32(off + 4, true);
    if (id === 'fmt ') {
      ch = v.getUint16(off + 10, true);
      sr = v.getUint32(off + 12, true);
      bits = v.getUint16(off + 22, true);
    } else if (id === 'data') {
      if (bits !== 16) throw new Error(`test WAV must be PCM16, got ${bits}-bit`);
      const frames = Math.floor(size / 2 / ch);
      const mono = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < ch; c++) sum += v.getInt16(off + 8 + (i * ch + c) * 2, true);
        mono[i] = sum / ch / 32768;
      }
      if (sr === 16_000) return mono;
      const out = new Float32Array(Math.floor((frames * 16_000) / sr));
      for (let i = 0; i < out.length; i++) {
        const x = (i * sr) / 16_000;
        const j = Math.floor(x);
        out[i] = mono[j] + ((mono[Math.min(j + 1, frames - 1)] ?? 0) - mono[j]) * (x - j);
      }
      return out;
    }
    off += 8 + size + (size & 1);
  }
  throw new Error('test WAV has no data chunk');
}

test.skipIf(!REAL)(
  'real Qwen3-ASR transcribes audio.wav with streaming deltas before the final result',
  async () => {
    const audio = readWav16k(await Bun.file(WAV).arrayBuffer());
    const eng = createSttEngine({ config: { idleTimeoutSec: 0 } });
    try {
      const t0 = performance.now();
      await eng.warmup();
      const loadMs = performance.now() - t0;

      const deltas: { at: number; chars: number }[] = [];
      const t1 = performance.now();
      const res = await eng.transcribe({
        audio,
        onDelta: (d) => deltas.push({ at: performance.now() - t1, chars: d.length }),
      });
      const latencyMs = performance.now() - t1;
      const st = eng.status();

      console.log(
        JSON.stringify(
          {
            loadMs: Math.round(loadMs),
            latencyMs: Math.round(latencyMs),
            audioSec: +res.duration.toFixed(2),
            rtf: +(latencyMs / 1000 / res.duration).toFixed(3),
            rssMB: st.rssBytes ? Math.round(st.rssBytes / 2 ** 20) : null,
            deltasBeforeFinal: deltas.length,
            deltaAtMs: deltas.map((d) => Math.round(d.at)),
            segments: res.segments.length,
            language: res.language,
            text: res.text,
          },
          null,
          2,
        ),
      );

      expect(res.text.length).toBeGreaterThan(0);
      expect(res.duration).toBeGreaterThan(1);
      expect(deltas.length).toBeGreaterThan(0);
      expect(deltas.map((d) => d.chars).reduce((a, b) => a + b, 0)).toBe(res.text.length);
      expect(st.state).toBe('ready');
    } finally {
      await eng.unload();
    }
  },
  240_000,
);
