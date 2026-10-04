/** STT job queue pieces: the job record, abort errors, the busy estimate and abort wiring. */
import { EngineBusyError, type TranscribeRequest, type TranscribeResult } from '../types';
import type { RollingStats } from './stats';

/** One transcription request waiting in, or taken from, the engine's FIFO queue. */
export type Job = {
  id: number;
  req: TranscribeRequest;
  resolve(r: TranscribeResult): void;
  reject(e: unknown): void;
  /** Caller aborted after the child took it; the result is dropped on arrival. */
  dropped: boolean;
  startedAt: number;
};

/** The signal's reason, or an AbortError when it has none. */
export const abortError = (s: AbortSignal) =>
  s.reason ?? new DOMException('STT request aborted', 'AbortError');

/** Queue full: Retry-After estimated from the median job time and the jobs ahead. */
export function queueBusyError(stats: RollingStats, queued: number): EngineBusyError {
  const p50 = stats.snapshot().p50Ms ?? 10_000;
  return new EngineBusyError('stt', Math.max(1, Math.ceil((p50 / 1000) * (queued + 1))));
}

/** On abort: a queued job leaves the queue; a taken one is dropped and the child asked to stop at the next span. */
export function rejectOnAbort(
  job: Job,
  signal: AbortSignal | undefined,
  queue: Job[],
  inFlight: () => Job | null,
  cancel: (id: number) => void,
): void {
  signal?.addEventListener(
    'abort',
    () => {
      const i = queue.indexOf(job);
      if (i >= 0) queue.splice(i, 1);
      else {
        job.dropped = true;
        // The span in flight cannot be interrupted over FFI; the child stops at the next span boundary.
        if (inFlight() === job && job.startedAt > 0) cancel(job.id);
      }
      job.reject(abortError(signal));
    },
    { once: true },
  );
}
