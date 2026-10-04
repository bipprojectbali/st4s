import type { Pointer } from 'bun:ffi';
import { describe, expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { openSttSession } from '../../server/engines/stt/child';
import { loadSttConfig } from '../../server/engines/stt/config';

describe('loadSttConfig CRISPASR_LIB', () => {
  const patched = path.join(os.homedir(), 'tmp/crispasr-s4s/build/src/libcrispasr.dylib');

  test('defaults to the patched build from scripts/crispasr/build.sh', () => {
    expect(loadSttConfig({}).libPath).toBe(patched);
    expect(loadSttConfig({ CRISPASR_LIB: '' }).libPath).toBe(patched);
  });

  test('env overrides the default', () => {
    expect(loadSttConfig({ CRISPASR_LIB: '/opt/lib/libcrispasr.dylib' }).libPath).toBe(
      '/opt/lib/libcrispasr.dylib',
    );
  });
});

describe('loadSttConfig STT_GPU', () => {
  test('defaults to CPU when unset or empty', () => {
    expect(loadSttConfig({}).useGpu).toBe(false);
    expect(loadSttConfig({ STT_GPU: '' }).useGpu).toBe(false);
  });

  test('truthy spellings enable GPU, anything else keeps CPU', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'on'])
      expect(loadSttConfig({ STT_GPU: v }).useGpu).toBe(true);
    for (const v of ['0', 'false', 'off', 'gpu', '2'])
      expect(loadSttConfig({ STT_GPU: v }).useGpu).toBe(false);
  });
});

/** Fake FFI: records each openSession call; `ok` decides per backend whether a session comes back. */
function fakeLib(ok: { gpu: boolean; cpu: boolean }) {
  const calls: boolean[] = [];
  return {
    calls,
    openSession: (_m: string, _t: number, gpu: boolean) => {
      calls.push(gpu);
      return (gpu ? ok.gpu : ok.cpu) ? (1 as unknown as Pointer) : null;
    },
  };
}

const cfg = (useGpu: boolean) => ({ modelPath: '/m/qwen3.gguf', threads: 4, useGpu });

describe('openSttSession', () => {
  test('CPU mode opens CPU only and never tries Metal', () => {
    const lib = fakeLib({ gpu: true, cpu: true });
    expect(openSttSession(lib, cfg(false)).gpu).toBe(false);
    expect(lib.calls).toEqual([false]);
  });

  test('GPU mode prefers GPU, falls back to CPU when GPU open fails', () => {
    const ok = fakeLib({ gpu: true, cpu: true });
    expect(openSttSession(ok, cfg(true)).gpu).toBe(true);
    expect(ok.calls).toEqual([true]);
    const fallback = fakeLib({ gpu: false, cpu: true });
    expect(openSttSession(fallback, cfg(true)).gpu).toBe(false);
    expect(fallback.calls).toEqual([true, false]);
  });

  test('throws with the model path and tried backends when nothing opens', () => {
    expect(() => openSttSession(fakeLib({ gpu: false, cpu: false }), cfg(false))).toThrow(
      '/m/qwen3.gguf (CPU)',
    );
    expect(() => openSttSession(fakeLib({ gpu: false, cpu: false }), cfg(true))).toThrow(
      '(GPU and CPU)',
    );
  });
});
