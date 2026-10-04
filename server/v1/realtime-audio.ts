/** Realtime input audio: base64 PCM16 24 kHz frames → 16 kHz Float32 turn buffer with absolute sample positions. */
import { createResampler24to16, pcm16ToFloat } from '../audio/resample';

/** Engine sample rate; buffer positions and VAD spans are in these samples. */
export const RT_SR = 16_000;

/** Samples → milliseconds since the session's first audio sample. */
export const toMs = (samples: number) => Math.round(samples / (RT_SR / 1000));

/** Growable 16 kHz buffer; `start`/`end` are absolute sample indexes since the session began. */
export function createAudioBuffer() {
  let data = new Float32Array(RT_SR * 4);
  let head = 0;
  let len = 0;
  let start = 0;

  return {
    get start() {
      return start;
    },
    get end() {
      return start + len;
    },
    append(x: Float32Array): void {
      if (head + len + x.length > data.length) {
        const next = new Float32Array(Math.max(data.length, (len + x.length) * 2));
        next.set(data.subarray(head, head + len));
        data = next;
        head = 0;
      }
      data.set(x, head + len);
      len += x.length;
    },
    /** Copy of [from, to) clamped to what is buffered. */
    slice(from: number, to: number): Float32Array {
      const a = Math.max(from, start) - start;
      const b = Math.min(to, start + len) - start;
      return b > a ? data.slice(head + a, head + b) : new Float32Array(0);
    },
    /** Forget everything before absolute index `to`. */
    drop(to: number): void {
      const k = Math.min(Math.max(to - start, 0), len);
      head += k;
      len -= k;
      start += k;
    },
  };
}

export type AudioBuffer = ReturnType<typeof createAudioBuffer>;

/** Decode one input_audio_buffer.append payload; throws a user-facing message on bad base64 or odd byte count. */
export function createAppendDecoder() {
  const resampler = createResampler24to16();
  return (b64: string): Float32Array => {
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.fromBase64(b64);
    } catch {
      throw new Error('`audio` bukan base64 yang valid.');
    }
    if (bytes.length % 2)
      throw new Error(`\`audio\` harus PCM16 (jumlah byte genap), diterima ${bytes.length} byte.`);
    return resampler.push(pcm16ToFloat(bytes));
  };
}
