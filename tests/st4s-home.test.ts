import { afterEach, describe, expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { loadSttConfig } from '../server/engines/stt/config';
import { ttsModelDir } from '../server/engines/tts/config';
import {
  CRISPASR_LIB_FILE,
  st4sHome,
  st4sLibDir,
  st4sLogsDir,
  st4sModelsDir,
} from '../server/st4s-home';

const saved = process.env.ST4S_HOME;
afterEach(() => {
  if (saved === undefined) delete process.env.ST4S_HOME;
  else process.env.ST4S_HOME = saved;
});

describe('st4sHome', () => {
  test('unset/blank outside a compiled binary → null, logs stay cwd-relative', () => {
    for (const env of [{}, { ST4S_HOME: '' }, { ST4S_HOME: '  ' }]) {
      expect(st4sHome(env)).toBeNull();
      expect(st4sLibDir(env)).toBeNull();
      expect(st4sModelsDir(env)).toBeNull();
      expect(st4sLogsDir(env)).toBe('logs');
    }
  });

  test('ST4S_HOME derives lib/, models/, logs/', () => {
    const env = { ST4S_HOME: '/opt/st4s' };
    expect(st4sHome(env)).toBe('/opt/st4s');
    expect(st4sLibDir(env)).toBe('/opt/st4s/lib');
    expect(st4sModelsDir(env)).toBe('/opt/st4s/models');
    expect(st4sLogsDir(env)).toBe('/opt/st4s/logs');
  });

  test('~ is expanded and relative paths become absolute', () => {
    expect(st4sHome({ ST4S_HOME: '~/.st4s' })).toBe(path.join(os.homedir(), '.st4s'));
    expect(st4sHome({ ST4S_HOME: '~' })).toBe(os.homedir());
    expect(st4sHome({ ST4S_HOME: 'rel/home' })).toBe(path.resolve('rel/home'));
  });

  test('reads process.env at call time', () => {
    process.env.ST4S_HOME = '/tmp/st4s-a';
    expect(st4sLogsDir()).toBe('/tmp/st4s-a/logs');
    process.env.ST4S_HOME = '/tmp/st4s-b';
    expect(st4sModelsDir()).toBe('/tmp/st4s-b/models');
  });
});

describe('engine paths under ST4S_HOME', () => {
  const home = { ST4S_HOME: '/opt/st4s' };

  test('every engine path is derived from the home', () => {
    const stt = loadSttConfig(home);
    expect(stt.libPath).toBe(`/opt/st4s/lib/${CRISPASR_LIB_FILE}`);
    expect(stt.modelPath).toBe('/opt/st4s/models/stt/qwen3-asr-1.7b-q4_k.gguf');
    expect(stt.vadModelPath).toBe('/opt/st4s/models/stt/ggml-silero-v6.2.0.bin');
    expect(stt.lidModelPath).toBe('/opt/st4s/models/stt/ggml-tiny.bin');
    expect(ttsModelDir(home)).toBe('/opt/st4s/models/tts');
  });

  test('explicit vars win over the home', () => {
    const env = {
      ...home,
      CRISPASR_LIB: '/x/lib.dylib',
      STT_MODEL: '/x/m.gguf',
      STT_VAD_MODEL: '/x/vad.bin',
      STT_LID_MODEL: '/x/lid.bin',
      TTS_MODEL_DIR: '/x/tts',
    };
    const stt = loadSttConfig(env);
    expect([stt.libPath, stt.modelPath, stt.vadModelPath, stt.lidModelPath]).toEqual([
      '/x/lib.dylib',
      '/x/m.gguf',
      '/x/vad.bin',
      '/x/lid.bin',
    ]);
    expect(ttsModelDir(env)).toBe('/x/tts');
  });

  test('empty STT_VAD_MODEL still disables VAD under a home', () => {
    expect(loadSttConfig({ ...home, STT_VAD_MODEL: '' }).vadModelPath).toBe('');
  });

  test('no home → exactly the dev defaults', () => {
    const cache = path.join(os.homedir(), '.cache/crispasr');
    const stt = loadSttConfig({});
    expect(stt.libPath).toBe(path.join(process.cwd(), '.crispasr/build/src/libcrispasr.dylib'));
    expect(stt.modelPath).toBe(path.join(cache, 'qwen3-asr-1.7b-q4_k.gguf'));
    expect(stt.vadModelPath).toBe(path.join(cache, 'ggml-silero-v6.2.0.bin'));
    expect(stt.lidModelPath).toBe(path.join(cache, 'ggml-tiny.bin'));
    expect(ttsModelDir({})).toBe(path.join(os.homedir(), '.wibu', 'tts', 'model'));
  });
});
