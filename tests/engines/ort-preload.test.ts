// Real dlopen of libonnxruntime is only verified by the end-to-end bundle check, not here.
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ortLibPath, preloadOrt } from '../../server/engines/tts/ort-preload';

describe('ortLibPath', () => {
  test('darwin → libonnxruntime.1.dylib', () => {
    expect(ortLibPath('/opt/st4s/lib', 'darwin')).toBe('/opt/st4s/lib/libonnxruntime.1.dylib');
  });
  test('linux → libonnxruntime.so.1', () => {
    expect(ortLibPath('/opt/st4s/lib', 'linux')).toBe('/opt/st4s/lib/libonnxruntime.so.1');
  });
  test('null lib dir or unsupported OS → null', () => {
    expect(ortLibPath(null, 'darwin')).toBeNull();
    expect(ortLibPath('/opt/st4s/lib', 'win32')).toBeNull();
  });
});

describe('preloadOrt', () => {
  test('no-op when not running as the compiled binary (normal test run)', () => {
    expect(Bun.isStandaloneExecutable).toBe(false);
    expect(() => preloadOrt()).not.toThrow();
    expect(() => preloadOrt(false, '/does/not/exist')).not.toThrow();
  });

  test('no-op in the binary when there is no lib dir', () => {
    expect(() => preloadOrt(true, null)).not.toThrow();
  });

  test('missing lib in the binary → error naming the path and st4s doctor', () => {
    const dir = mkdtempSync(join(tmpdir(), 'st4s-ort-'));
    try {
      const expected = ortLibPath(dir);
      expect(expected).not.toBeNull();
      expect(() => preloadOrt(true, dir)).toThrow(expected as string);
      expect(() => preloadOrt(true, dir)).toThrow('st4s doctor');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
