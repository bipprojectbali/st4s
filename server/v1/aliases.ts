/** Model and voice ids accepted by /api/v1, including OpenAI aliases. */

export const STT_MODEL_ID = 'qwen3-asr-1.7b';
export const TTS_MODEL_ID = 'supertonic-3';

export const STT_MODEL_ALIASES = [
  'whisper-1',
  'gpt-4o-transcribe',
  'gpt-4o-mini-transcribe',
] as const;
export const TTS_MODEL_ALIASES = ['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts'] as const;

export const NATIVE_VOICES = ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5'] as const;

/** OpenAI voice name -> native Supertonic style. */
export const VOICE_ALIASES: Readonly<Record<string, (typeof NATIVE_VOICES)[number]>> = {
  alloy: 'F1',
  coral: 'F2',
  fable: 'F3',
  nova: 'F4',
  shimmer: 'F5',
  sage: 'F5',
  ash: 'M1',
  ballad: 'M2',
  echo: 'M3',
  onyx: 'M4',
  verse: 'M5',
  marin: 'F2',
  cedar: 'M4',
};

export function isSttModel(id: string): boolean {
  return id === STT_MODEL_ID || (STT_MODEL_ALIASES as readonly string[]).includes(id);
}

export function isTtsModel(id: string): boolean {
  return id === TTS_MODEL_ID || (TTS_MODEL_ALIASES as readonly string[]).includes(id);
}

/** Native voice id for a native or OpenAI voice name (case-insensitive), or null. */
export function resolveVoice(input: string): string | null {
  const upper = input.toUpperCase();
  if ((NATIVE_VOICES as readonly string[]).includes(upper)) return upper;
  return VOICE_ALIASES[input.toLowerCase()] ?? null;
}
