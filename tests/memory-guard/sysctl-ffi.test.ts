/** darwin FFI sysctl reader: same value as the sysctl CLI, rejects unknown names, cheap enough for a 500 ms poll. */
import { describe, expect, test } from 'bun:test';
import { createSysctlInt, installSysctlFfi } from '../../server/memory-guard/sysctl-ffi';

describe.skipIf(process.platform !== 'darwin')('sysctlbyname over bun:ffi', () => {
  const read = createSysctlInt();

  test('reads memorystatus level and pressure', () => {
    const level = read('kern.memorystatus_level');
    expect(level).toBeGreaterThanOrEqual(0);
    expect(level).toBeLessThanOrEqual(100);
    expect([1, 2, 4]).toContain(read('kern.memorystatus_vm_pressure_level'));
    const cli = Number(Bun.spawnSync(['sysctl', '-n', 'hw.ncpu']).stdout.toString());
    expect(read('hw.ncpu')).toBe(cli);
  });

  test('unknown name throws with its name', () => {
    expect(() => read('kern.no_such_thing_st4s')).toThrow('kern.no_such_thing_st4s');
  });

  test('one read stays well under a millisecond', () => {
    const N = 2000;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) read('kern.memorystatus_level');
    expect((performance.now() - t0) / N).toBeLessThan(0.1);
  });
});

test('installSysctlFfi is a no-op off darwin', () => {
  expect(installSysctlFfi('linux')).toBe(false);
});
