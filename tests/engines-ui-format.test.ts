/** Engine/playground formatters: small uploads must not collapse to "0 MB". */
import { describe, expect, test } from 'bun:test';
import { depsFor, formatBytes } from '../app/lib/engines-api';

describe('formatBytes', () => {
  test('picks a unit that keeps small sizes visible', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(11)).toBe('11 B');
    expect(formatBytes(12_800)).toBe('12,5 KB');
    expect(formatBytes(340 * 1024 ** 2)).toBe('340 MB');
    expect(formatBytes(1.25 * 1024 ** 3)).toBe('1,3 GB');
  });
});

describe('depsFor', () => {
  const deps = [
    'CRISPASR_LIB',
    'STT_MODEL',
    'STT_VAD_MODEL',
    'STT_LID_MODEL',
    'TTS_MODEL_DIR',
    'FFMPEG_PATH',
  ].map((name) => ({ name, ok: true, detail: '/x' }));
  test('splits engine deps and shares ffmpeg', () => {
    expect(depsFor('stt', deps).map((d) => d.name)).toEqual([
      'CRISPASR_LIB',
      'STT_MODEL',
      'STT_VAD_MODEL',
      'STT_LID_MODEL',
      'FFMPEG_PATH',
    ]);
    expect(depsFor('tts', deps).map((d) => d.name)).toEqual(['TTS_MODEL_DIR', 'FFMPEG_PATH']);
  });
});
