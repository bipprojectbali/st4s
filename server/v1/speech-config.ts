/** Settings for POST /v1/audio/speech, read from env with documented defaults. */

function intEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export const speechConfig = {
  /** TTS_DEFAULT_LANGUAGE — language when the request omits `language` (default "id"). */
  defaultLanguage: process.env.TTS_DEFAULT_LANGUAGE || 'id',
  /** FFMPEG_PATH — ffmpeg binary for mp3/opus/aac/flac (default "ffmpeg" on PATH). */
  ffmpegBin: process.env.FFMPEG_PATH || 'ffmpeg',
  /** TTS_FFMPEG_TIMEOUT_MS — hard cap on one ffmpeg encode (default 120000). */
  ffmpegTimeoutMs: intEnv('TTS_FFMPEG_TIMEOUT_MS', 120_000),
  /** TTS_MAX_UNIT_CHARS — longest text unit sent to the engine in one call (default 400). */
  maxUnitChars: intEnv('TTS_MAX_UNIT_CHARS', 400),
  /** OpenAI's documented input limit. */
  maxInputChars: 4096,
  /** `steps` (denoising steps) is clamped to this range. */
  stepsMin: 1,
  stepsMax: 20,
};
