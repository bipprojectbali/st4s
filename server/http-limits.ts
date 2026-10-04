/** HTTP-level limits for the production Bun.serve (prod.ts), kept pure so tests can check them. */
import { v1Config } from './v1/config';

/** Seconds a socket may stay silent before Bun closes it (lifted per request by `needsLongTimeout`). */
export const IDLE_TIMEOUT_SEC = 60;

const LONG_PREFIXES = ['/api/v1/audio/', '/api/engines/'];

/** Paths whose handler can stay silent for minutes (queued STT/TTS jobs, model warmup): no idle timeout. */
export function needsLongTimeout(pathname: string): boolean {
  return LONG_PREFIXES.some((p) => pathname.startsWith(p));
}

/** Largest accepted request body: the v1 upload limit plus 1 MiB for multipart framing and fields. */
export function maxRequestBodyBytes(): number {
  return v1Config.maxUploadBytes + 1024 * 1024;
}

/** Bun.serve options shared by every request; the body limit makes Bun answer 413 before buffering. */
export function serveLimits() {
  return { idleTimeout: IDLE_TIMEOUT_SEC, maxRequestBodySize: maxRequestBodyBytes() };
}
