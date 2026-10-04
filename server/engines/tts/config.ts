import os from 'node:os';
import path from 'node:path';

/** TTS engine settings, read from env with documented defaults. */
export interface TtsConfig {
  /** TTS_MODEL_DIR — contains onnx/ and voice_styles/ (read-only). Default ~/.wibu/tts/model. */
  modelDir: string;
  /** TTS_STEPS — denoising steps when the request gives none. Default 8 (upstream default). */
  steps: number;
  /** TTS_THREADS — onnxruntime intra-op threads; 0 = onnxruntime default. */
  threads: number;
  /** TTS_MAX_QUEUE — waiting requests before EngineBusyError. Default 8. */
  maxQueue: number;
  /** TTS_IDLE_TIMEOUT_SEC — unload the child after this idle time; 0 = never. Default 600. */
  idleTimeoutSec: number;
}

function intEnv(name: string, fallback: number, min: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) throw new Error(`${name} must be an integer >= ${min}, got "${raw}"`);
  return n;
}

/** Read the TTS config from process.env. */
export function loadTtsConfig(): TtsConfig {
  return {
    modelDir: process.env.TTS_MODEL_DIR || path.join(os.homedir(), '.wibu', 'tts', 'model'),
    steps: intEnv('TTS_STEPS', 8, 1),
    threads: intEnv('TTS_THREADS', 0, 0),
    maxQueue: intEnv('TTS_MAX_QUEUE', 8, 1),
    idleTimeoutSec: intEnv('TTS_IDLE_TIMEOUT_SEC', 600, 0),
  };
}
