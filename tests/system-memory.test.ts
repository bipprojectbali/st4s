/** Available RAM: darwin uses kern.memorystatus_level × total; bad sysctl output falls back to freemem with a warn. */
import { afterAll, afterEach, describe, expect, spyOn, test } from 'bun:test';
import { logger } from '../server/logger';
import { readAvailableMemory } from '../server/system-memory';

const GB = 1024 ** 3;
const base = { totalmem: () => 8 * GB, freemem: () => 100 * 1024 ** 2 };
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

  test('non-darwin keeps os.freemem and never runs sysctl', () => {
    const sysctl = () => {
      throw new Error('must not run');
    };
    expect(readAvailableMemory({ ...base, platform: 'linux', sysctl })).toBe(100 * 1024 ** 2);
    expect(warn).not.toHaveBeenCalled();
  });

  test('real platform returns a positive byte count', () => {
    expect(readAvailableMemory()).toBeGreaterThan(0);
  });
});
