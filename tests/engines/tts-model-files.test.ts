import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSampleRate, readVoices } from '../../server/engines/tts/model-files';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st4s-tts-model-files-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('tts model files', () => {
  test('reads the sample rate and sorted .json voice names', () => {
    fs.mkdirSync(path.join(dir, 'onnx'));
    fs.writeFileSync(
      path.join(dir, 'onnx', 'tts.json'),
      JSON.stringify({ ae: { sample_rate: 44100 } }),
    );
    fs.mkdirSync(path.join(dir, 'voice_styles'));
    for (const f of ['M1.json', 'F1.json', 'notes.txt'])
      fs.writeFileSync(path.join(dir, 'voice_styles', f), '{}');
    expect(readSampleRate(dir)).toBe(44100);
    expect(readVoices(dir)).toEqual(['F1', 'M1']);
  });

  test('missing files: sample rate throws with the path, voices return null', () => {
    const empty = path.join(dir, 'missing');
    expect(() => readSampleRate(empty)).toThrow(path.join(empty, 'onnx', 'tts.json'));
    expect(readVoices(empty)).toBeNull();
  });
});
