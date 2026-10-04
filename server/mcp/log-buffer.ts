import { Writable } from 'node:stream';

export type LogEntry = {
  level: number;
  time: number;
  msg: string;
  /** Monotonic sequence assigned on push — stable key for UI lists. */
  seq?: number;
  [key: string]: unknown;
};

export const LEVEL_NUMBERS: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

export const LEVEL_NAMES: Record<number, string> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

export type LogFilter = { level?: string; search?: string; since?: number; after?: number };

export class LogBuffer {
  private entries: LogEntry[] = [];
  private seq = 0;
  private listeners = new Set<(entry: LogEntry) => void>();

  constructor(readonly maxSize: number) {}

  push(entry: LogEntry) {
    const stored = { ...entry, seq: ++this.seq };
    this.entries.push(stored);
    if (this.entries.length > this.maxSize) this.entries.shift();
    for (const fn of this.listeners) fn(stored);
  }

  /** Called with every entry pushed from now on; returns the unsubscribe function. */
  subscribe(fn: (entry: LogEntry) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Whether `e` passes the level (minimum), time, sequence and full-text filters. */
  matches(e: LogEntry, f: LogFilter): boolean {
    if (f.level && e.level < (LEVEL_NUMBERS[f.level] ?? 0)) return false;
    if (f.since && e.time < f.since) return false;
    if (f.after && (e.seq ?? 0) <= f.after) return false;
    if (f.search && !JSON.stringify(e).toLowerCase().includes(f.search.toLowerCase())) return false;
    return true;
  }

  /** Entries at or above `minLevel` logged since `sinceMs` (epoch). */
  countSince(minLevel: number, sinceMs: number): number {
    let n = 0;
    for (const e of this.entries) if (e.level >= minLevel && e.time >= sinceMs) n++;
    return n;
  }

  /** Counts per level name, plus buffer occupancy and the oldest entry time. */
  stats(): {
    byLevel: Record<string, number>;
    size: number;
    capacity: number;
    oldest: number | null;
    newest: number | null;
  } {
    const byLevel: Record<string, number> = {};
    for (const e of this.entries) {
      const name = LEVEL_NAMES[e.level] ?? String(e.level);
      byLevel[name] = (byLevel[name] ?? 0) + 1;
    }
    return {
      byLevel,
      size: this.entries.length,
      capacity: this.maxSize,
      oldest: this.entries[0]?.time ?? null,
      newest: this.entries.at(-1)?.time ?? null,
    };
  }

  clear() {
    this.entries = [];
  }

  query(opts: LogFilter & { limit?: number }): LogEntry[] {
    return this.entries.filter((e) => this.matches(e, opts)).slice(-(opts.limit ?? 50));
  }

  size() {
    return this.entries.length;
  }

  /** Returns a Node Writable that accepts raw Pino JSON lines and pushes them into the buffer. */
  asWritable(): Writable {
    const buf = this;
    return new Writable({
      write(chunk: Buffer, _enc: string, cb: () => void) {
        try {
          const line = chunk.toString().trim();
          if (line) buf.push(JSON.parse(line) as LogEntry);
        } catch {
          // Not a JSON line (pretty-printer noise) — nothing to buffer.
        }
        cb();
      },
    });
  }
}

/** Singleton ring buffer — shared between logger.ts, the MCP log tools and /dev/server-logs. */
// Process-wide singleton: the Vite-built SSR bundle carries its own copy of this
// module, and both copies must feed the same buffer that /dev/server-logs reads.
const g = globalThis as typeof globalThis & { __st4sLogBuffer?: LogBuffer };
g.__st4sLogBuffer ??= new LogBuffer(1000);
export const logBuffer: LogBuffer = g.__st4sLogBuffer;
