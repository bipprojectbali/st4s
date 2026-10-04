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

/** Parent → child IPC message. */
export type ToChild = TranscribeMsg | CancelMsg;

/** Child → parent IPC message. */
export type FromChild =
  | { t: 'ready'; loadMs: number; rss: number; backend: string; gpu: boolean }
  | { t: 'load_error'; message: string }
  | { t: 'delta'; id: number; text: string }
  | { t: 'result'; id: number; result: TranscribeResult; rss: number }
  | { t: 'cancelled'; id: number; rss: number }
  | { t: 'error'; id: number; message: string; rss: number };
