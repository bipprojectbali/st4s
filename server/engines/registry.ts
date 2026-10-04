import type { SttEngine, TtsEngine } from './types';

/** Process-wide engine registry; kept on globalThis so the SSR bundle copy shares it. */
type Slots = { stt: SttEngine | null; tts: TtsEngine | null };

const g = globalThis as typeof globalThis & { __st4sEngines?: Slots };
g.__st4sEngines ??= { stt: null, tts: null };
const slots: Slots = g.__st4sEngines;

export function setEngines(next: Partial<Slots>): void {
  Object.assign(slots, next);
}

export function getStt(): SttEngine {
  if (!slots.stt) throw new Error('STT engine is not registered');
  return slots.stt;
}

export function getTts(): TtsEngine {
  if (!slots.tts) throw new Error('TTS engine is not registered');
  return slots.tts;
}
