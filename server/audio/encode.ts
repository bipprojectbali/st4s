/** Float32 PCM → OpenAI output formats that need no external tool (pcm, wav). */

/** Output formats accepted by POST /v1/audio/speech. */
export const SPEECH_FORMATS = ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'] as const;
export type SpeechFormat = (typeof SPEECH_FORMATS)[number];

/** Formats encoded in-process; the rest go through ffmpeg. */
export const NATIVE_FORMATS: readonly SpeechFormat[] = ['wav', 'pcm'];

/** Content-Type per output format. */
export const CONTENT_TYPES: Record<SpeechFormat, string> = {
  mp3: 'audio/mpeg',
  opus: 'audio/ogg',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wav: 'audio/wav',
  pcm: 'audio/pcm',
};

/** OpenAI `pcm` is raw 24 kHz signed 16-bit little-endian mono. */
export const PCM_RATE = 24_000;

/** Linear-interpolation resample of mono audio. */
// ponytail: linear, no anti-alias low-pass; swap for a windowed-sinc/ffmpeg resampler if aliasing is audible.
export function resampleLinear(x: Float32Array, from: number, to: number): Float32Array {
  if (from === to || x.length === 0) return x;
  const n = Math.max(1, Math.round((x.length * to) / from));
  const out = new Float32Array(n);
  const step = from / to;
  for (let i = 0; i < n; i++) {
    const pos = i * step;
    const j = Math.floor(pos);
    const a = x[Math.min(j, x.length - 1)];
    const b = x[Math.min(j + 1, x.length - 1)];
    out[i] = a + (b - a) * (pos - j);
  }
  return out;
}

/** Float32 [-1, 1] → signed 16-bit little-endian bytes (clipped). */
export function floatToS16le(x: Float32Array): Uint8Array {
  const out = new Uint8Array(x.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < x.length; i++) {
    const s = Math.max(-1, Math.min(1, x[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

const UNKNOWN_SIZE = 0xffffffff;

/** 44-byte PCM16 mono WAV header; `dataBytes = null` writes the streaming variant (sizes 0xFFFFFFFF). */
export function wavHeader(sampleRate: number, dataBytes: number | null): Uint8Array {
  const out = new Uint8Array(44);
  const v = new DataView(out.buffer);
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  v.setUint32(4, dataBytes === null ? UNKNOWN_SIZE : 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ascii(36, 'data');
  v.setUint32(40, dataBytes === null ? UNKNOWN_SIZE : dataBytes, true);
  return out;
}

/** Encode a stream of Float32 units as pcm (resampled to 24 kHz) or wav (engine rate). */
export async function* encodeNative(
  format: 'wav' | 'pcm',
  sampleRate: number,
  units: AsyncIterable<Float32Array>,
  knownSamples: number | null = null,
): AsyncGenerator<Uint8Array> {
  if (format === 'wav')
    yield wavHeader(sampleRate, knownSamples === null ? null : knownSamples * 2);
  for await (const x of units) {
    yield floatToS16le(format === 'pcm' ? resampleLinear(x, sampleRate, PCM_RATE) : x);
  }
}
