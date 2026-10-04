/** Cheap admission control for /audio/transcriptions: queue-full check before reading audio, bounded decoding. */
import { decodeTo16kMono } from '../audio/decode';
import { loadSttConfig } from '../engines/stt/config';
import { EngineBusyError, type SttEngine } from '../engines/types';
import { v1Config } from './config';

/** Counting semaphore; the limit is read on every acquire so env changes apply without a restart. */
export class Semaphore {
  active = 0;
  private waiters: (() => void)[] = [];

  constructor(private readonly limit: () => number) {}

  /** A release function, or null when no slot frees up within `waitMs`. */
  acquire(waitMs: number): Promise<(() => void) | null> {
    if (this.active < this.limit()) {
      this.active++;
      return Promise.resolve(this.releaser());
    }
    return new Promise((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        this.active++;
        resolve(this.releaser());
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== wake);
        resolve(null);
      }, waitMs);
      this.waiters.push(wake);
    });
  }

  private releaser(): () => void {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.active--;
      while (this.active < this.limit()) {
        const wake = this.waiters.shift();
        if (!wake) break;
        wake();
      }
    };
  }
}

const decodeSlots = new Semaphore(() => v1Config.decodeConcurrency);

/** Mirrors the engine's own estimate: p50 job time × jobs ahead (10 s when there is no history yet). */
const retryAfterSec = (engine: SttEngine, queued: number) =>
  Math.max(1, Math.ceil(((engine.status().stats.p50Ms ?? 10_000) / 1000) * (queued + 1)));

/** EngineBusyError when the STT queue is already full, so the request is refused before its audio is read. */
export function queueFullError(engine: SttEngine): EngineBusyError | null {
  const { queued } = engine.status();
  return queued >= loadSttConfig().maxQueue
    ? new EngineBusyError('stt', retryAfterSec(engine, queued))
    : null;
}

/** decodeTo16kMono under the V1_DECODE_CONCURRENCY limit; throws EngineBusyError when no slot frees in time. */
export async function decodeUpload(
  file: File,
): Promise<{ audio: Float32Array; durationSec: number }> {
  const waitMs = v1Config.decodeWaitMs;
  const release = await decodeSlots.acquire(waitMs);
  if (!release) throw new EngineBusyError('stt', Math.max(1, Math.ceil(waitMs / 1000)));
  try {
    return await decodeTo16kMono(await file.bytes(), { mime: file.type, filename: file.name });
  } finally {
    release();
  }
}
