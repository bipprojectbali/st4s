/** Static Supertonic model metadata read from TTS_MODEL_DIR: output sample rate and voice style names. */
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../../logger';

/** Sample rate from `onnx/tts.json`; throws with the file path when it cannot be read. */
export function readSampleRate(modelDir: string): number {
  const file = path.join(modelDir, 'onnx', 'tts.json');
  try {
    return (JSON.parse(fs.readFileSync(file, 'utf8')) as { ae: { sample_rate: number } }).ae
      .sample_rate;
  } catch (e) {
    throw new Error(`Cannot read TTS sample rate from ${file}: ${(e as Error).message}`);
  }
}

/** Sorted voice names from `voice_styles/*.json`; null (after a warning) when the directory is unreadable. */
export function readVoices(modelDir: string): string[] | null {
  const dir = path.join(modelDir, 'voice_styles');
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -5))
      .sort();
  } catch (e) {
    logger.warn({ dir, err: (e as Error).message }, 'tts: voice style dir unreadable');
    return null;
  }
}
