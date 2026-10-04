import { describe, expect, test } from 'bun:test';
import { LEVEL_NAMES, LogBuffer, logBuffer } from '../../server/mcp/log-buffer';

// ── LogBuffer unit tests ─────────────────────────────────────────────────────

describe('LogBuffer', () => {
  test('stores and retrieves entries', () => {
    const buf = new LogBuffer(10);
    buf.push({ level: 50, time: Date.now(), msg: 'test error' });
    const entries = buf.query({});
    expect(entries.length).toBe(1);
    expect(entries[0].msg).toBe('test error');
  });

  test('respects maxSize (ring buffer evicts oldest)', () => {
    const buf = new LogBuffer(3);
    for (let i = 0; i < 5; i++) {
      buf.push({ level: 30, time: i, msg: `msg${i}` });
    }
    const entries = buf.query({});
    expect(entries.length).toBe(3);
    // Oldest entries (0, 1) evicted — only 2, 3, 4 remain
    expect(entries[0].msg).toBe('msg2');
    expect(entries[2].msg).toBe('msg4');
  });

  test('filters by minimum level', () => {
    const buf = new LogBuffer(10);
    buf.push({ level: 30, time: Date.now(), msg: 'info' });
    buf.push({ level: 40, time: Date.now(), msg: 'warn' });
    buf.push({ level: 50, time: Date.now(), msg: 'error' });

    const warns = buf.query({ level: 'warn' });
    expect(warns.length).toBe(2);
    expect(warns.every((e) => e.level >= 40)).toBe(true);

    const errors = buf.query({ level: 'error' });
    expect(errors.length).toBe(1);
    expect(errors[0].msg).toBe('error');
  });

  test('filters by search text (case-insensitive)', () => {
    const buf = new LogBuffer(10);
    buf.push({ level: 50, time: Date.now(), msg: 'Database connection failed' });
    buf.push({ level: 50, time: Date.now(), msg: 'Request timeout' });

    const results = buf.query({ search: 'database' });
    expect(results.length).toBe(1);
    expect(results[0].msg).toBe('Database connection failed');
  });

  test('filters by since timestamp', () => {
    const buf = new LogBuffer(10);
    const past = Date.now() - 10000;
    const recent = Date.now();
    buf.push({ level: 50, time: past, msg: 'old error' });
    buf.push({ level: 50, time: recent, msg: 'new error' });

    const results = buf.query({ since: past + 1 });
    expect(results.length).toBe(1);
    expect(results[0].msg).toBe('new error');
  });

  test('respects limit', () => {
    const buf = new LogBuffer(20);
    for (let i = 0; i < 10; i++) {
      buf.push({ level: 50, time: i, msg: `error${i}` });
    }
    const limited = buf.query({ limit: 3 });
    expect(limited.length).toBe(3);
    // Returns the last N entries (most recent)
    expect(limited[2].msg).toBe('error9');
  });

  test('asWritable() parses Pino JSON lines into buffer', async () => {
    const buf = new LogBuffer(10);
    const writable = buf.asWritable();
    const entry = { level: 50, time: Date.now(), msg: 'written via stream', pid: 123 };
    writable.write(`${JSON.stringify(entry)}\n`);
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(buf.size()).toBe(1);
    expect(buf.query({})[0].msg).toBe('written via stream');
  });

  test('asWritable() silently ignores non-JSON lines', async () => {
    const buf = new LogBuffer(10);
    const writable = buf.asWritable();
    writable.write('not json at all\n');
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(buf.size()).toBe(0);
  });
});

// ── LEVEL_NAMES sanity ───────────────────────────────────────────────────────

describe('LEVEL_NAMES', () => {
  test('contains expected pino levels', () => {
    expect(LEVEL_NAMES[10]).toBe('trace');
    expect(LEVEL_NAMES[30]).toBe('info');
    expect(LEVEL_NAMES[40]).toBe('warn');
    expect(LEVEL_NAMES[50]).toBe('error');
    expect(LEVEL_NAMES[60]).toBe('fatal');
  });
});

// ── Singleton logBuffer ──────────────────────────────────────────────────────

describe('logBuffer singleton', () => {
  test('is a LogBuffer instance', () => {
    expect(logBuffer).toBeInstanceOf(LogBuffer);
  });
});
