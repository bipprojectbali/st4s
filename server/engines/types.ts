/** Shared contract between the speech engines (server/engines/{stt,tts}) and the /v1 API. */

export type EngineState = 'unloaded' | 'loading' | 'ready' | 'busy' | 'error';

export interface EngineStats {
  requests: number;
  errors: number;
  p50Ms: number | null;
  p95Ms: number | null;
  /** Real-time factor (processing time / audio duration), median. */
  rtfP50: number | null;
}

export interface EngineStatus {
  kind: 'stt' | 'tts';
  model: string;
  state: EngineState;
  queued: number;
  loadedAt: string | null;
  lastError: string | null;
  /** RSS of the engine child process, when known. */
  rssBytes: number | null;
  stats: EngineStats;
}

export interface EngineControl {
  status(): EngineStatus;
  /** Load the model ahead of the first request. */
  warmup(): Promise<void>;
  /** Stop the child process and free its memory; the next request reloads it. */
  unload(): Promise<void>;
}

export interface WordTiming {
  word: string;
  start: number;
  end: number;
  probability?: number;
}

export interface TranscriptSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  words?: WordTiming[];
}

export interface TranscribeRequest {
  /** 16 kHz mono PCM, range [-1, 1]. */
  audio: Float32Array;
  /** ISO 639-1 code; undefined = auto-detect. */
  language?: string;
  hotwords?: string[];
  wordTimestamps?: boolean;
  signal?: AbortSignal;
  /** Incremental text as the decoder produces it (drives `stream=true`). */
  onDelta?: (text: string) => void;
}

export interface TranscribeResult {
  text: string;
  language: string;
  /** Input audio duration in seconds. */
  duration: number;
  segments: TranscriptSegment[];
}

export interface SttEngine extends EngineControl {
  transcribe(req: TranscribeRequest): Promise<TranscribeResult>;
}

export interface SpeakRequest {
  text: string;
  /** Native voice id (e.g. "F1", "M3"); aliases are resolved by the caller. */
  voice: string;
  /** ISO 639-1 code. */
  language: string;
  /** 0.25–4, 1 = normal. */
  speed: number;
  /** Denoising steps; engine default when undefined. */
  steps?: number;
  signal?: AbortSignal;
}

export interface TtsEngine extends EngineControl {
  readonly sampleRate: number;
  voices(): readonly string[];
  /** Mono PCM in [-1, 1] at `sampleRate`. */
  synthesize(req: SpeakRequest): Promise<Float32Array>;
}

/** Thrown when an engine queue is full; the API maps it to 429 + Retry-After. */
export class EngineBusyError extends Error {
  constructor(
    readonly kind: 'stt' | 'tts',
    readonly retryAfterSec: number,
  ) {
    super(`${kind} engine queue is full`);
  }
}
