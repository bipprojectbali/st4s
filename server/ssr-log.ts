/**
 * Bridge between the React Router SSR bundle and the process logger.
 *
 * The SSR bundle (build/server/index.js) is compiled by Vite and would get its
 * *own* copy of server/logger.ts if it imported it — a second pino instance,
 * a second file writer, and a separate in-memory buffer that /dev/server-logs
 * never sees. Instead the Bun process registers its logger here and the SSR
 * side (app/entry.server.tsx) calls `processLog`, which falls back to console
 * when no logger is registered (tests, isolated renders).
 */
export type ProcessLogLevel = 'warn' | 'error';
export type ProcessLogger = Record<ProcessLogLevel, (obj: unknown, msg: string) => void>;

const KEY = '__st4sProcessLogger' as const;
type Holder = typeof globalThis & { [KEY]?: ProcessLogger };

export function registerProcessLogger(logger: ProcessLogger | null): void {
  (globalThis as Holder)[KEY] = logger ?? undefined;
}

export function processLog(level: ProcessLogLevel, obj: unknown, msg: string): void {
  const logger = (globalThis as Holder)[KEY];
  if (logger) logger[level](obj, msg);
  else console[level](msg, obj);
}
