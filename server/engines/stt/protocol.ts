import type { TranscribeResult } from '../types';

/** Parent → child IPC message. */
export type ToChild = {
  t: 'transcribe';
  id: number;
  audio: Float32Array;
  /** ISO 639-1 or 'auto'. */
  language: string;
  hotwords: string[];
  words: boolean;
};

/** Child → parent IPC message. */
export type FromChild =
  | { t: 'ready'; loadMs: number; rss: number; backend: string; gpu: boolean }
  | { t: 'load_error'; message: string }
  | { t: 'delta'; id: number; text: string }
  | { t: 'result'; id: number; result: TranscribeResult; rss: number }
  | { t: 'error'; id: number; message: string; rss: number };
