/** Pure audio helpers for the realtime client: resample, Float32 → PCM16 LE, base64. */

const B64_SLICE = 0x8000;

/** Float32 [-1, 1] → 16-bit little-endian PCM bytes; out-of-range samples are clamped. */
export function floatToPcm16(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] || 0));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

/** Bytes → base64, converted in slices so large buffers never overflow the call stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += B64_SLICE) {
    bin += String.fromCharCode(...bytes.subarray(i, i + B64_SLICE));
  }
  return btoa(bin);
}

/**
 * Streaming mono resampler: downsampling averages each input window (a cheap anti-alias box
 * filter), upsampling interpolates linearly. Leftover input carries over between chunks so a
 * chunked stream produces the same samples as one big buffer.
 */
export function createResampler(fromRate: number, toRate: number) {
  const step = fromRate / toRate;
  let carry = new Float32Array(0);
  // Absolute counters (not an accumulated fraction) so chunk boundaries never shift a window.
  let produced = 0;
  let dropped = 0;
  return (input: Float32Array): Float32Array => {
    const joined = new Float32Array(carry.length + input.length);
    joined.set(carry);
    joined.set(input, carry.length);
    const total = dropped + joined.length;
    const out = new Float32Array(Math.ceil(joined.length / step) + 1);
    let n = 0;
    if (step >= 1) {
      while ((produced + 1) * step <= total) {
        const a = Math.floor(produced * step) - dropped;
        const b = Math.floor((produced + 1) * step) - dropped;
        let sum = 0;
        for (let i = a; i < b; i++) sum += joined[i];
        out[n++] = sum / (b - a);
        produced++;
      }
    } else {
      while (Math.floor(produced * step) + 1 < total) {
        const pos = produced * step;
        const i = Math.floor(pos);
        const f = pos - i;
        out[n++] = joined[i - dropped] * (1 - f) + joined[i + 1 - dropped] * f;
        produced++;
      }
    }
    const keep = Math.floor(produced * step) - dropped;
    carry = joined.slice(keep);
    dropped += keep;
    return out.slice(0, n);
  };
}
