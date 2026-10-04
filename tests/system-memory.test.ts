/** Available RAM: darwin memorystatus level × total (+ kernel pressure), Linux /proc/meminfo; failures fall back to freemem with a warn. */
import { afterAll, afterEach, describe, expect, spyOn, test } from 'bun:test';
import { logger } from '../server/logger';
import { readAvailableMemory, readMemorySnapshot } from '../server/system-memory';

const GB = 1024 ** 3;
const base = { totalmem: () => 8 * GB, freemem: () => 100 * 1024 ** 2, pressure: () => 1 };
const MEMINFO =
  'MemTotal:        8000000 kB\nMemFree:          100000 kB\nMemAvailable:    2000000 kB\n';
const warn = spyOn(logger, 'warn');
afterEach(() => warn.mockClear());
// Bun's spyOn reuses a live spy, so leaving it would leak calls into later files.
afterAll(() => warn.mockRestore());

describe('readAvailableMemory', () => {
  test('darwin: percent from sysctl times total memory', () => {
    const bytes = readAvailableMemory({ ...base, platform: 'darwin', sysctl: () => '61\n' });
    expect(bytes).toBe(Math.round(0.61 * 8 * GB));
    expect(warn).not.toHaveBeenCalled();
  });

  test('darwin: garbage output falls back to os.freemem and warns', () => {
    for (const out of ['', 'abc', '150']) {
      expect(readAvailableMemory({ ...base, platform: 'darwin', sysctl: () => out })).toBe(
        100 * 1024 ** 2,
      );
    }
    expect(warn).toHaveBeenCalledTimes(3);
  });

  test('darwin: sysctl failure falls back to os.freemem and warns', () => {
    const sysctl = () => {
      throw new Error('sysctl exited 1');
    };
    expect(readAvailableMemory({ ...base, platform: 'darwin', sysctl })).toBe(100 * 1024 ** 2);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('linux: MemAvailable from /proc/meminfo and never runs sysctl', () => {
    const sysctl = () => {
      throw new Error('must not run');
    };
    expect(
      readAvailableMemory({ ...base, platform: 'linux', sysctl, meminfo: () => MEMINFO }),
    ).toBe(2000000 * 1024);
    expect(warn).not.toHaveBeenCalled();
  });

  test('linux: unreadable /proc/meminfo falls back to os.freemem and warns', () => {
    const meminfo = () => {
      throw new Error('ENOENT');
    };
    expect(readAvailableMemory({ ...base, platform: 'linux', meminfo })).toBe(100 * 1024 ** 2);
    expect(
      readAvailableMemory({ ...base, platform: 'linux', meminfo: () => 'MemTotal: 1 kB\n' }),
    ).toBe(100 * 1024 ** 2);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  test('real platform returns a positive byte count', () => {
    expect(readAvailableMemory()).toBeGreaterThan(0);
  });
});

describe('readMemorySnapshot', () => {
  test('darwin: free percent and kernel pressure level', () => {
    const s = readMemorySnapshot({
      ...base,
      platform: 'darwin',
      sysctl: () => '18',
      pressure: () => 4,
    });
    expect(s).toEqual({
      freeBytes: Math.round(0.18 * 8 * GB),
      totalBytes: 8 * GB,
      freePct: 18,
      pressure: 4,
    });
  });

  test('darwin fallback reports freePct null so the guard does not act on free pages alone', () => {
    const s = readMemorySnapshot({ ...base, platform: 'darwin', sysctl: () => 'x' });
    expect(s.freePct).toBeNull();
    expect(s.pressure).toBe(1);
  });

  test('linux: percent rounded to 0.1 and no pressure', () => {
    const s = readMemorySnapshot({ ...base, platform: 'linux', meminfo: () => MEMINFO });
    expect(s.freePct).toBe(25);
    expect(s.pressure).toBeNull();
    expect(s.totalBytes).toBe(8000000 * 1024);
  });
});
