/** Native RIFF/WAVE reader: PCM int 8/16/24/32-bit and IEEE float 32-bit, any rate and channel count. */

const PCM = 1;
const FLOAT = 3;
const EXTENSIBLE = 0xfffe;

export type WavMono = { samples: Float32Array; sampleRate: number };

/** True when the bytes start with a RIFF/WAVE header. */
export function isWav(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  return tag(0) === 'RIFF' && tag(8) === 'WAVE';
}

/** Decode a WAV file to mono (channels averaged) at its native rate; throws with a reason on malformed input. */
export function parseWav(bytes: Uint8Array): WavMono {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | null = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      if (size < 16) throw new Error('WAV fmt chunk is too short');
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
      if (!fmt) throw new Error('WAV data chunk appears before fmt chunk');
      // Streamed WAVs may carry 0xFFFFFFFF or a too-large size: clamp to what was uploaded.
      const len = Math.min(size, bytes.length - body);
      return { samples: toMono(view, body, len, fmt), sampleRate: fmt.sampleRate };
    }
    offset = body + size + (size % 2);
  }
  throw new Error('WAV file has no data chunk');
}

function toMono(
  view: DataView,
  start: number,
  len: number,
  f: { format: number; channels: number; sampleRate: number; bits: number },
): Float32Array {
  const read = sampleReader(view, f.format, f.bits);
  if (f.channels < 1 || f.sampleRate < 1) throw new Error('WAV header has no channels or sample rate');
  const width = f.bits / 8;
  const frameBytes = width * f.channels;
  const frames = Math.floor(len / frameBytes);
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
  if (format !== PCM) throw new Error(`WAV encoding ${format} (${bits}-bit) is not supported`);
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
      throw new Error(`WAV PCM ${bits}-bit is not supported`);
  }
}
