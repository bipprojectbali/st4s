/** server_vad turn detection: re-scans the newest buffered audio with Silero (in the STT child) and finds turn edges. */
import type { VadOptions } from '../engines/stt/vad';
import { type AudioBuffer, RT_SR } from './realtime-audio';
import type { ServerVad } from './realtime-protocol';

/** New audio needed before another VAD call (256 ms). */
const STEP = 4_096;
/** Extra history re-scanned beyond the silence window, so a span cut by the last window edge is seen whole. */
const CONTEXT_MS = 500;
const ms = (v: number) => Math.round((v * RT_SR) / 1000);

export type VadTrackerDeps = {
  buf: AudioBuffer;
  config(): ServerVad | null;
  vad(audio: Float32Array, opts: VadOptions): Promise<[number, number][]>;
  /** Speech began; the turn audio starts at absolute sample `from` (prefix padding included). */
  started(from: number): void;
  /** Speech ended; commit the turn up to absolute sample `to`. */
  stopped(to: number): void;
  failed(err: unknown): void;
};

/** One VAD call in flight at most; a slow call (model loading) just widens the next window. */
export function createVadTracker(d: VadTrackerDeps) {
  let speaking = false;
  let scannedTo = d.buf.start;
  let lastSpeechEnd = 0;
  /** Audio before this belongs to an earlier turn. */
  let floor = d.buf.start;
  let inFlight = false;
  let gen = 0;
  let closed = false;

  function handle(td: ServerVad, winStart: number, winEnd: number, spans: [number, number][]) {
    const silence = ms(td.silence_duration_ms);
    for (const [s, e] of spans) {
      const a = winStart + Math.round(s * RT_SR);
      const b = winStart + Math.round(e * RT_SR);
      if (b <= floor) continue;
      if (!speaking) {
        speaking = true;
        const from = Math.max(floor, d.buf.start, Math.max(a, floor) - ms(td.prefix_padding_ms));
        d.started(from);
      }
      lastSpeechEnd = Math.max(lastSpeechEnd, b);
    }
    if (speaking && winEnd - lastSpeechEnd >= silence) {
      const to = Math.min(winEnd, lastSpeechEnd + silence);
      speaking = false;
      floor = to;
      d.stopped(to);
    } else if (!speaking) {
      d.buf.drop(winEnd - Math.max(ms(td.prefix_padding_ms), silence + ms(CONTEXT_MS)));
    }
  }

  async function run(td: ServerVad) {
    const myGen = gen;
    const winEnd = d.buf.end;
    const winStart = Math.max(
      d.buf.start,
      floor,
      scannedTo - ms(td.silence_duration_ms + CONTEXT_MS),
    );
    inFlight = true;
    try {
      const spans = await d.vad(d.buf.slice(winStart, winEnd), {
        threshold: td.threshold,
        minSilenceMs: td.silence_duration_ms,
      });
      if (closed || myGen !== gen) return;
      scannedTo = winEnd;
      handle(td, winStart, winEnd, spans);
    } catch (err) {
      if (!closed && myGen === gen) d.failed(err);
      return;
    } finally {
      inFlight = false;
    }
    poke();
  }

  /** Call after each append; starts a VAD call when enough new audio is buffered. */
  function poke(): void {
    const td = d.config();
    if (closed || inFlight || !td || d.buf.end - Math.max(scannedTo, floor) < STEP) return;
    void run(td);
  }

  return {
    poke,
    get speaking() {
      return speaking;
    },
    /** A turn was committed (manual, overflow) or the buffer cleared: start over after `to`, ignore in-flight results. */
    reset(to: number): void {
      gen++;
      speaking = false;
      floor = to;
      scannedTo = to;
      lastSpeechEnd = to;
    },
    close(): void {
      closed = true;
    },
  };
}
