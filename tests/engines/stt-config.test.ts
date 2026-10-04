import type { Pointer } from 'bun:ffi';
import { describe, expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { openSttSession } from '../../server/engines/stt/child';
import { defaultCrispasrLib, loadSttConfig } from '../../server/engines/stt/config';
import { dlopenCrispasr } from '../../server/engines/stt/ffi';

describe('loadSttConfig CRISPASR_LIB', () => {
  const patched = path.join(process.cwd(), '.crispasr/build/src/libcrispasr.dylib');

  test('defaults to the in-project build from scripts/crispasr/build.sh', () => {
    for (const env of [{}, { CRISPASR_LIB: '' }]) {
      const lib = loadSttConfig(env).libPath;
      expect(lib).toBe(patched);
      expect(path.isAbsolute(lib)).toBe(true);
      expect(lib.endsWith('/.crispasr/build/src/libcrispasr.dylib')).toBe(true);
    }
  });

  test('default resolves against the given project dir', () => {
    expect(defaultCrispasrLib('/srv/st4s')).toBe('/srv/st4s/.crispasr/build/src/libcrispasr.dylib');
  });

  test('a missing lib fails with its path and the build command', () => {
    const missing = path.join(os.tmpdir(), 'st4s-no-such-dir/libcrispasr.dylib');
    expect(() => dlopenCrispasr(missing)).toThrow(
      `libcrispasr not found at ${missing} — run \`bash scripts/crispasr/build.sh\` or set CRISPASR_LIB`,
    );
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
