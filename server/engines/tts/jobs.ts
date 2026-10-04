/** TTS job queue pieces: the job record, request validation, settling and the busy estimate. */
import { EngineBusyError, type SpeakRequest } from '../types';
import type { RollingStats } from './stats';
import { isTtsLanguage } from './text';

/** One synthesis request waiting in, or taken from, the engine's FIFO queue. */
export interface Job {
  id: number;
  req: SpeakRequest;
  steps: number;
  settled: boolean;
  startedAt: number;
  resolve(pcm: Float32Array): void;
  reject(err: unknown): void;
}

/** Validate a request and return its effective step count; throws the first problem found. */
export function checkSpeakRequest(
  req: SpeakRequest,
  voices: () => readonly string[],
  defaultSteps: number,
): number {
  if (!req.text.trim()) throw new Error('TTS input text is empty');
  if (!isTtsLanguage(req.language)) throw new Error(`Unsupported TTS language "${req.language}"`);
  if (!voices().includes(req.voice)) throw new Error(`Unknown TTS voice "${req.voice}"`);
  if (!(req.speed >= 0.25 && req.speed <= 4))
    throw new Error(`TTS speed ${req.speed} out of range 0.25–4`);
  const steps = req.steps ?? defaultSteps;
  if (!Number.isInteger(steps) || steps < 1)
    throw new Error(`TTS steps must be a positive integer`);
  return steps;
}

/** Resolve with PCM or reject with anything else, once; later calls are ignored. */
export function settle(job: Job, result: Float32Array | unknown): void {
  if (job.settled) return;
  job.settled = true;
  if (result instanceof Float32Array) job.resolve(result);
  else job.reject(result);
}

/** Queue full: Retry-After estimated from the median job time and the jobs ahead. */
export function queueBusyError(stats: RollingStats, queued: number): EngineBusyError {
  const perJobMs = stats.p50Ms ?? 5000;
  return new EngineBusyError('tts', Math.max(1, Math.ceil(((queued + 1) * perJobMs) / 1000)));
}
