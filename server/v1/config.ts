/** /api/v1 limits, read from env on every call so tests and ops can change them without a restart. */

const num = (name: string, fallback: number): number => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export const v1Config = {
  /** V1_MAX_UPLOAD_MB (default 25): larger uploads get 413. */
  get maxUploadBytes() {
    return num('V1_MAX_UPLOAD_MB', 25) * 1024 * 1024;
  },
  /** V1_MAX_AUDIO_SEC (default 1800): longer audio gets 400. */
  get maxAudioSec() {
    return num('V1_MAX_AUDIO_SEC', 1800);
  },
  /** FFMPEG_PATH (default "ffmpeg", looked up on PATH): decodes non-WAV uploads and encodes TTS mp3/opus/aac/flac. */
  get ffmpegPath() {
    return process.env.FFMPEG_PATH || 'ffmpeg';
  },
  /** V1_FFMPEG_TIMEOUT_MS (default 120000): upload-decoding ffmpeg is killed after this. */
  get ffmpegTimeoutMs() {
    return num('V1_FFMPEG_TIMEOUT_MS', 120_000);
  },
  /** V1_DECODE_CONCURRENCY (default 2): uploads decoded at once; each holds its upload + ffmpeg + PCM buffers. */
  get decodeConcurrency() {
    return Math.max(1, Math.floor(num('V1_DECODE_CONCURRENCY', 2)));
  },
  /** V1_DECODE_WAIT_MS (default 5000): longest wait for a decode slot before the API answers 429. */
  get decodeWaitMs() {
    return num('V1_DECODE_WAIT_MS', 5_000);
  },
};
