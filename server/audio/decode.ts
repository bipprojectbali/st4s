/** Uploaded audio -> 16 kHz mono float32 for the STT engine. WAV is decoded in-process, the rest via ffmpeg. */
import { logger } from '../logger';
import { ffmpegTo16kMono, findFfmpeg } from './decode-ffmpeg';
import { isWav, parseWav } from './decode-wav';

export const TARGET_RATE = 16_000;

/** Decode failure the API reports as 400 with `code`. */
export class AudioDecodeError extends Error {
  constructor(
    readonly code: 'unsupported_format' | 'invalid_audio',
    message: string,
  ) {
    super(message);
  }
}

const SUPPORTED_NATIVE = 'WAV (PCM 8/16/24/32-bit atau float32)';
const SUPPORTED_FFMPEG = 'flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm';

/** Linear-interpolation resample of mono PCM to TARGET_RATE. */
export function resampleLinear(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate === TARGET_RATE) return input;
  const outLen = Math.round((input.length * TARGET_RATE) / fromRate);
  const out = new Float32Array(outLen);
  const step = fromRate / TARGET_RATE;
  const last = input.length - 1;
  for (let i = 0; i < outLen; i++) {
    const pos = i * step;
    const i0 = Math.min(Math.floor(pos), last);
    const i1 = Math.min(i0 + 1, last);
    const frac = pos - i0;
    out[i] = input[i0] + (input[i1] - input[i0]) * frac;
  }
  return out;
}

/** Decode `bytes` (any supported container) to 16 kHz mono; `durationSec` is the source duration. */
export async function decodeTo16kMono(
  bytes: Uint8Array<ArrayBuffer>,
  hint: { mime?: string; filename?: string } = {},
): Promise<{ audio: Float32Array; durationSec: number }> {
  if (isWav(bytes)) {
    try {
      const { samples, sampleRate } = parseWav(bytes);
      return { audio: resampleLinear(samples, sampleRate), durationSec: samples.length / sampleRate };
    } catch (err) {
      // Unusual WAV encodings (ADPCM, µ-law, 64-bit float) still have a chance with ffmpeg.
      if (!findFfmpeg()) throw new AudioDecodeError('invalid_audio', `File WAV tidak bisa didekode: ${(err as Error).message}`);
    }
  }
  const bin = findFfmpeg();
  if (!bin) {
    throw new AudioDecodeError(
      'unsupported_format',
      `Format audio tidak didukung${hint.filename ? ` (${hint.filename})` : ''}. Server ini mendekode ${SUPPORTED_NATIVE}; pasang ffmpeg agar juga menerima ${SUPPORTED_FFMPEG}.`,
    );
  }
  try {
    const audio = await ffmpegTo16kMono(bin, bytes);
    return { audio, durationSec: audio.length / TARGET_RATE };
  } catch (err) {
    logger.warn({ err, mime: hint.mime, bytes: bytes.length }, 'audio decode via ffmpeg failed');
    throw new AudioDecodeError(
      'invalid_audio',
      `File audio tidak bisa didekode. Format yang didukung: ${SUPPORTED_FFMPEG}.`,
    );
  }
}
