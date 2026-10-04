/** logger and logBuffer are process singletons shared with the Vite-built SSR bundle copy. */
import { describe, expect, test } from 'bun:test';
import { logger } from '../server/logger';
import { logBuffer } from '../server/mcp/log-buffer';

type G = typeof globalThis & { __st4sLogger?: unknown; __st4sLogBuffer?: unknown };

describe('process singletons', () => {
  test('are registered on globalThis and reused', () => {
    const g = globalThis as G;
    expect(g.__st4sLogger).toBe(logger);
    expect(g.__st4sLogBuffer).toBe(logBuffer);
  });
  test('logger writes land in the shared buffer', () => {
    const marker = `singleton-${crypto.randomUUID().slice(0, 8)}`;
    const before = logBuffer.size();
    logger.warn({ marker }, marker);
    expect(logBuffer.size()).toBeGreaterThanOrEqual(before);
    expect(logBuffer.query({ search: marker }).length).toBe(1);
  });
});
