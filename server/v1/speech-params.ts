/** Validation of the POST /v1/audio/speech JSON body into engine-ready parameters. */
import { SPEECH_FORMATS, type SpeechFormat } from '../audio/encode';
import { isTtsLanguage } from '../engines/tts/text';
import { isTtsModel, resolveVoice } from './aliases';
import { v1Error } from './errors';
import { speechConfig } from './speech-config';

export type SpeechParams = {
  model: string;
  input: string;
  /** Requested voice name (for logs). */
  voiceName: string;
  /** Native engine voice id. */
  voice: string;
  format: SpeechFormat;
  speed: number;
  streamFormat: 'audio' | 'sse';
  language: string;
  steps?: number;
};

// OpenAI: "`sse` is not supported for `tts-1` or `tts-1-hd`".
const NO_SSE_MODELS = ['tts-1', 'tts-1-hd'];

const bad = (message: string, param: string, code = 'invalid_value') =>
  v1Error(400, message, { code, param });

/** Parsed params, or a 400 OpenAI-shaped Response naming the offending `param`. */
export function parseSpeechParams(body: unknown): SpeechParams | Response {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return bad('Body harus berupa objek JSON.', 'body', 'invalid_request');
  const b = body as Record<string, unknown>;

  if (typeof b.model !== 'string' || !isTtsModel(b.model))
    return bad(`Model TTS tidak dikenal: ${String(b.model)}. Pakai supertonic-3 atau tts-1.`, 'model', 'model_not_found');

  if (typeof b.input !== 'string' || b.input.trim().length === 0)
    return bad('`input` wajib berisi teks.', 'input');
  if (b.input.length > speechConfig.maxInputChars)
    return bad(`\`input\` maksimal ${speechConfig.maxInputChars} karakter.`, 'input', 'string_above_max_length');

  const voiceName =
    typeof b.voice === 'string'
      ? b.voice
      : b.voice && typeof b.voice === 'object' && typeof (b.voice as { id?: unknown }).id === 'string'
        ? (b.voice as { id: string }).id
        : null;
  const voice = voiceName === null ? null : resolveVoice(voiceName);
  if (voiceName === null || voice === null)
    return bad(`Voice tidak dikenal: ${String(voiceName)}.`, 'voice');

  const format = (b.response_format ?? 'mp3') as SpeechFormat;
  if (!SPEECH_FORMATS.includes(format))
    return bad(`response_format harus salah satu dari ${SPEECH_FORMATS.join(', ')}.`, 'response_format');

  const speed = b.speed ?? 1;
  if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0.25 || speed > 4)
    return bad('`speed` harus angka 0.25–4.', 'speed');

  const streamFormat = b.stream_format ?? 'audio';
  if (streamFormat !== 'audio' && streamFormat !== 'sse')
    return bad('stream_format harus "audio" atau "sse".', 'stream_format');
  if (streamFormat === 'sse' && NO_SSE_MODELS.includes(b.model))
    return bad(`stream_format "sse" tidak didukung untuk ${b.model}; pakai gpt-4o-mini-tts.`, 'stream_format', 'unsupported_value');

  const rawLanguage = b.language ?? speechConfig.defaultLanguage;
  const language = typeof rawLanguage === 'string' ? rawLanguage.toLowerCase() : '';
  if (!isTtsLanguage(language))
    return bad(`\`language\` tidak didukung: ${String(rawLanguage)}. Pakai kode ISO 639-1, mis. "id" atau "en".`, 'language', 'unsupported_value');

  let steps: number | undefined;
  if (b.steps !== undefined && b.steps !== null) {
    if (typeof b.steps !== 'number' || !Number.isFinite(b.steps))
      return bad('`steps` harus angka.', 'steps');
    steps = Math.min(speechConfig.stepsMax, Math.max(speechConfig.stepsMin, Math.round(b.steps)));
  }

  return {
    model: b.model,
    input: b.input,
    voiceName,
    voice,
    format,
    speed,
    streamFormat,
    language,
    steps,
  };
}
