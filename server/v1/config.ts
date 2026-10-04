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
  /** V1_FFMPEG_PATH (default "ffmpeg", looked up on PATH): decoder for non-WAV uploads. */
  get ffmpegPath() {
    return process.env.V1_FFMPEG_PATH || 'ffmpeg';
  },
  /** V1_FFMPEG_TIMEOUT_MS (default 120000): ffmpeg is killed after this. */
  get ffmpegTimeoutMs() {
    return num('V1_FFMPEG_TIMEOUT_MS', 120_000);
  },
};
