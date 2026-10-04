/** test-only: build RIFF/WAVE files in memory (PCM int 8/16/24/32 or float32, any rate/channels). */
export function makeWav(opts: {
  sampleRate: number;
  channels: number;
  bits: 8 | 16 | 24 | 32;
  float?: boolean;
  frames: number;
  /** Sample value in [-1, 1] for frame i, channel c; default a 440 Hz sine. */
  value?: (i: number, c: number) => number;
}): Uint8Array<ArrayBuffer> {
  const { sampleRate, channels, bits, frames } = opts;
  const value = opts.value ?? ((i: number) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / sampleRate));
  const bytesPer = bits / 8;
  const dataSize = frames * channels * bytesPer;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const ascii = (off: number, s: string) => [...s].forEach((ch, k) => v.setUint8(off + k, ch.charCodeAt(0)));
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + dataSize, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, opts.float ? 3 : 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels * bytesPer, true);
  v.setUint16(32, channels * bytesPer, true);
  v.setUint16(34, bits, true);
  ascii(36, 'data');
  v.setUint32(40, dataSize, true);
  let off = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const x = Math.max(-1, Math.min(1, value(i, c)));
      if (opts.float) v.setFloat32(off, x, true);
      else if (bits === 8) v.setUint8(off, Math.round(x * 127) + 128);
      else if (bits === 16) v.setInt16(off, Math.round(x * 32767), true);
      else if (bits === 24) {
        const n = Math.round(x * 8_388_607);
        v.setUint8(off, n & 0xff);
        v.setUint8(off + 1, (n >> 8) & 0xff);
        v.setUint8(off + 2, (n >> 16) & 0xff);
      } else v.setInt32(off, Math.round(x * 2_147_483_647), true);
      off += bytesPer;
    }
  }
  return new Uint8Array(buf);
}
