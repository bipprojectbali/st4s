import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import path from 'node:path';
import { checkEngineDeps, type EngineDep, logEngineDeps } from '../../server/engines/deps';
import { logger } from '../../server/logger';

// test-only paths; nothing on disk is touched (exists/which are injected).
const env = {
  CRISPASR_LIB: '/m/libcrispasr.dylib',
  STT_MODEL: '/m/stt.gguf',
  STT_VAD_MODEL: '/m/vad.bin',
  STT_LID_MODEL: '/m/lid.bin',
  TTS_MODEL_DIR: '/m/tts',
  FFMPEG_PATH: '/opt/ffmpeg',
};
const present = new Set([
  '/m/libcrispasr.dylib',
  '/m/stt.gguf',
  '/m/vad.bin',
  '/m/lid.bin',
  path.join('/m/tts', 'onnx'),
  path.join('/m/tts', 'voice_styles'),
]);
const byName = (deps: EngineDep[]) => Object.fromEntries(deps.map((d) => [d.name, d]));

describe('checkEngineDeps', () => {
  test('all present → every dep ok, detail is the resolved path', () => {
    const deps = checkEngineDeps({ env, exists: (p) => present.has(p), which: (b) => b });
    expect(deps.map((d) => d.name)).toEqual([
      'CRISPASR_LIB',
      'STT_MODEL',
      'STT_VAD_MODEL',
      'STT_LID_MODEL',
      'TTS_MODEL_DIR',
      'FFMPEG_PATH',
    ]);
    expect(deps.every((d) => d.ok)).toBe(true);
    expect(byName(deps).FFMPEG_PATH.detail).toBe('/opt/ffmpeg');
    expect(byName(deps).TTS_MODEL_DIR.detail).toBe('/m/tts');
  });

  test('missing files and ffmpeg are reported with the missing path', () => {
    const exists = (p: string) => present.has(p) && p !== '/m/stt.gguf' && !p.endsWith('voice_styles');
    const deps = byName(checkEngineDeps({ env, exists, which: () => null }));
    expect(deps.STT_MODEL).toEqual({ name: 'STT_MODEL', ok: false, detail: 'tidak ditemukan: /m/stt.gguf' });
    expect(deps.TTS_MODEL_DIR.ok).toBe(false);
    expect(deps.TTS_MODEL_DIR.detail).toContain('voice_styles');
    expect(deps.TTS_MODEL_DIR.detail).not.toContain('onnx');
    expect(deps.FFMPEG_PATH.ok).toBe(false);
    expect(deps.FFMPEG_PATH.detail).toContain('/opt/ffmpeg');
    expect(deps.CRISPASR_LIB.ok).toBe(true);
  });

  test('empty STT_VAD_MODEL disables VAD and is not a failure; FFMPEG_PATH defaults to ffmpeg', () => {
    const seen: string[] = [];
    const deps = byName(
      checkEngineDeps({
        env: { ...env, STT_VAD_MODEL: '', FFMPEG_PATH: undefined },
        exists: () => false,
        which: (b) => (seen.push(b), null),
      }),
    );
    expect(deps.STT_VAD_MODEL.ok).toBe(true);
    expect(deps.STT_VAD_MODEL.detail).toContain('nonaktif');
    expect(seen).toEqual(['ffmpeg']);
  });
});

describe('logEngineDeps', () => {
  const spies: { mockRestore(): void }[] = [];
  afterEach(() => {
    for (const s of spies.splice(0)) s.mockRestore();
  });
  const deps: EngineDep[] = [
    { name: 'STT_MODEL', ok: false, detail: 'tidak ditemukan: /m/stt.gguf' },
    { name: 'FFMPEG_PATH', ok: true, detail: '/opt/ffmpeg' },
    { name: 'TTS_MODEL_DIR', ok: false, detail: 'tidak ditemukan: /m/tts/onnx' },
  ];

  test('production logs one error per missing dep', () => {
    const error = spyOn(logger, 'error').mockImplementation(() => undefined);
    const warn = spyOn(logger, 'warn').mockImplementation(() => undefined);
    spies.push(error, warn);
    expect(logEngineDeps(deps, true)).toBe(2);
    expect(error).toHaveBeenCalledTimes(2);
    expect(error.mock.calls[0]?.[0]).toEqual({ dep: 'STT_MODEL', detail: 'tidak ditemukan: /m/stt.gguf' });
    expect(warn).not.toHaveBeenCalled();
  });

  test('dev logs warn instead; nothing missing logs nothing', () => {
    const error = spyOn(logger, 'error').mockImplementation(() => undefined);
    const warn = spyOn(logger, 'warn').mockImplementation(() => undefined);
    spies.push(error, warn);
    expect(logEngineDeps(deps, false)).toBe(2);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(logEngineDeps([deps[1]], false)).toBe(0);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(error).not.toHaveBeenCalled();
  });
});
