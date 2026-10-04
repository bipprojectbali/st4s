import type { SttEngine } from '../types';
import type { FromChild, ToChild, VadReply } from './protocol';

/** Silero tuning for one VAD call; spans come back in seconds within the window. */
export type VadOptions = { threshold: number; minSilenceMs: number };

/** Optional STT capability: Silero speech spans for a short 16 kHz window, run in the STT child. */
export type SttVad = {
  vad(audio: Float32Array, opts: VadOptions): Promise<[number, number][]>;
};

/** True when the registered STT engine can answer VAD requests. */
export function hasVad(e: SttEngine): e is SttEngine & SttVad {
  return typeof (e as Partial<SttVad>).vad === 'function';
}

/** True for child messages that belong to the VAD bridge, not to a transcription job. */
export function isVadReply(m: FromChild): m is VadReply {
  return m.t === 'vad_result' || m.t === 'vad_error';
}

type Pending = { resolve(s: [number, number][]): void; reject(e: unknown): void };

/** Routes VAD requests to the STT child and their replies back; ids are separate from job ids. */
export function createVadBridge(deps: {
  /** Resolves once a child is ready (loads the model if needed). */
  ensure(): Promise<void>;
  /** Sends to the live child; false when there is none. */
  send(m: ToChild): boolean;
}) {
  const pending = new Map<number, Pending>();
  let nextId = 1;

  async function vad(audio: Float32Array, opts: VadOptions): Promise<[number, number][]> {
    await deps.ensure();
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      const sent = deps.send({ t: 'vad', id, audio, ...opts });
      if (!sent) {
        pending.delete(id);
        reject(new Error(`STT child gone before VAD request ${id}`));
      }
    });
  }

  function onMessage(m: VadReply): void {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.t === 'vad_result') p.resolve(m.spans);
    else p.reject(new Error(`STT VAD failed: ${m.message}`));
  }

  function failAll(err: Error): void {
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  }

  return { vad, onMessage, failAll };
}
