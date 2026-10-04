/** Streaming 24 kHz → 16 kHz resampler for PCM16 realtime audio (3:2, windowed-sinc anti-alias). */

const HALF = 16;
/** Cutoff 7.2 kHz on the 24 kHz grid leaves a transition band below the 8 kHz output Nyquist. */
const FC = 7_200 / 24_000;

function kernel(frac: number): Float32Array {
  const h = new Float32Array(2 * HALF);
  let sum = 0;
  for (let i = 0; i < 2 * HALF; i++) {
    const x = i - HALF + 1 - frac;
    const sinc = x === 0 ? 1 : Math.sin(2 * Math.PI * FC * x) / (2 * Math.PI * FC * x);
    const w = 0.5 + 0.5 * Math.cos((Math.PI * x) / HALF);
    h[i] = sinc * w;
    sum += h[i];
  }
  for (let i = 0; i < h.length; i++) h[i] /= sum;
  return h;
}

// Output n sits at input time 1.5n: even n on a sample, odd n halfway between two.
const PHASES = [kernel(0), kernel(0.5)];

/** Decode little-endian PCM16 bytes to Float32 in [-1, 1); throws on an odd byte count. */
export function pcm16ToFloat(bytes: Uint8Array): Float32Array {
  if (bytes.length % 2) throw new Error(`PCM16 needs an even byte count, got ${bytes.length}`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const out = new Float32Array(bytes.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

/** Stateful 24k → 16k resampler; history carries across chunks so chunk boundaries add no clicks. */
export function createResampler24to16() {
  // Input samples from absolute index `base` on; samples before 0 are silence.
  let buf = new Float32Array(HALF);
  let base = -HALF;
  let n = 0;

  return {
    push(input: Float32Array): Float32Array {
      const next = new Float32Array(buf.length + input.length);
      next.set(buf);
      next.set(input, buf.length);
      buf = next;
      const end = base + buf.length;
      const out: number[] = [];
      for (;;) {
        const c = Math.floor(n * 1.5);
        if (c + HALF >= end) break;
        const h = PHASES[n & 1];
        const off = c - HALF + 1 - base;
        let acc = 0;
        for (let i = 0; i < h.length; i++) acc += buf[off + i] * h[i];
        out.push(acc);
        n++;
      }
      const keepFrom = Math.floor(n * 1.5) - HALF + 1 - base;
      buf = buf.slice(keepFrom);
      base += keepFrom;
      return Float32Array.from(out);
    },
  };
}
