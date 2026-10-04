import type { TranscribeResult } from '../types';

/** Parent → child: transcribe one job. */
export type TranscribeMsg = {
  t: 'transcribe';
  id: number;
  audio: Float32Array;
  /** ISO 639-1 or 'auto'. */
  language: string;
  hotwords: string[];
  words: boolean;
};

/** Parent → child: stop job `id` at the next span boundary (the span in flight still finishes). */
export type CancelMsg = { t: 'cancel'; id: number };

/** Parent → child: Silero speech spans for a short window (answered between transcription spans). */
export type VadMsg = {
  t: 'vad';
  id: number;
  audio: Float32Array;
  threshold: number;
  minSilenceMs: number;
};

/** Parent → child IPC message. */
export type ToChild = TranscribeMsg | CancelMsg | VadMsg;

/** Child → parent answer to a VadMsg; spans are [start, end] seconds within its window. */
export type VadReply =
  | { t: 'vad_result'; id: number; spans: [number, number][] }
  | { t: 'vad_error'; id: number; message: string };

/** Child → parent IPC message. */
export type FromChild =
  | { t: 'ready'; loadMs: number; rss: number; backend: string; gpu: boolean }
  | { t: 'load_error'; message: string }
  | { t: 'delta'; id: number; text: string }
  | { t: 'result'; id: number; result: TranscribeResult; rss: number }
  | { t: 'cancelled'; id: number; rss: number }
  /** `code` types the failure across IPC (class identity does not survive it); `message` is the operator detail. */
  | { t: 'error'; id: number; message: string; code?: 'vad_failed'; rss: number }
  | VadReply;
