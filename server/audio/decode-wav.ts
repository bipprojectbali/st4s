/** Native RIFF/WAVE reader: PCM int 8/16/24/32-bit and IEEE float 32-bit, any rate and channel count. */

const PCM = 1;
const FLOAT = 3;
const EXTENSIBLE = 0xfffe;

/** `samples` is empty when `durationSec` exceeds the caller's `maxSec` (nothing was decoded). */
export type WavMono = { samples: Float32Array; sampleRate: number; durationSec: number };

/** True when the bytes start with a RIFF/WAVE header. */
export function isWav(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const tag = (o: number) =>
    String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  return tag(0) === 'RIFF' && tag(8) === 'WAVE';
}

/** Decode a WAV file to mono (channels averaged) at its native rate; throws with a reason on malformed input. */
export function parseWav(bytes: Uint8Array, maxSec = Number.POSITIVE_INFINITY): WavMono {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | null = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3],
    );
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      if (size < 16) throw new Error('chunk fmt WAV terlalu pendek');
      let format = view.getUint16(body, true);
      // WAVE_FORMAT_EXTENSIBLE: the real format is the first 2 bytes of the SubFormat GUID.
      if (format === EXTENSIBLE && size >= 40) format = view.getUint16(body + 24, true);
      fmt = {
        format,
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      if (!fmt) throw new Error('chunk data WAV muncul sebelum chunk fmt');
      // Streamed WAVs may carry 0xFFFFFFFF or a too-large size: clamp to what was uploaded.
      const len = Math.min(size, bytes.length - body);
      const read = sampleReader(view, fmt.format, fmt.bits);
      if (fmt.channels < 1 || fmt.sampleRate < 1)
        throw new Error('header WAV tidak punya jumlah kanal atau sample rate');
      const frames = Math.floor(len / ((fmt.bits / 8) * fmt.channels));
      const durationSec = frames / fmt.sampleRate;
      const samples = durationSec > maxSec ? new Float32Array(0) : toMono(body, frames, fmt, read);
      return { samples, sampleRate: fmt.sampleRate, durationSec };
    }
    offset = body + size + (size % 2);
  }
  throw new Error('file WAV tidak punya chunk data');
}

function toMono(
  start: number,
  frames: number,
  f: { channels: number; bits: number },
  read: (o: number) => number,
): Float32Array {
  const width = f.bits / 8;
  const frameBytes = width * f.channels;
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    const base = start + i * frameBytes;
    for (let c = 0; c < f.channels; c++) sum += read(base + c * width);
    out[i] = sum / f.channels;
  }
  return out;
}

function sampleReader(view: DataView, format: number, bits: number): (o: number) => number {
  if (format === FLOAT && bits === 32) return (o) => view.getFloat32(o, true);
  if (format !== PCM) throw new Error(`encoding WAV ${format} (${bits}-bit) tidak didukung`);
  switch (bits) {
    case 8:
      return (o) => (view.getUint8(o) - 128) / 128;
    case 16:
      return (o) => view.getInt16(o, true) / 32768;
    case 24:
      return (o) => {
        const v = view.getUint8(o) | (view.getUint8(o + 1) << 8) | (view.getInt8(o + 2) << 16);
        return v / 8388608;
      };
    case 32:
      return (o) => view.getInt32(o, true) / 2147483648;
    default:
      throw new Error(`WAV PCM ${bits}-bit tidak didukung`);
  }
}
