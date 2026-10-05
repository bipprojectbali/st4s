import os from 'node:os';
import path from 'node:path';
import { st4sModelsDir } from '../../st4s-home';

/** TTS engine settings, read from env with documented defaults. */
export interface TtsConfig {
  /** TTS_MODEL_DIR — contains onnx/ and voice_styles/ (read-only). See ttsModelDir(). */
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
  if (!Number.isInteger(n) || n < min)
    throw new Error(`${name} must be an integer >= ${min}, got "${raw}"`);
  return n;
}

/** TTS_MODEL_DIR, else `<ST4S_HOME>/models/tts`, else the dev default ~/.wibu/tts/model. */
export function ttsModelDir(env: Record<string, string | undefined> = process.env): string {
  if (env.TTS_MODEL_DIR) return env.TTS_MODEL_DIR;
  const modelsDir = st4sModelsDir(env);
  return modelsDir ? path.join(modelsDir, 'tts') : path.join(os.homedir(), '.wibu', 'tts', 'model');
}

/** Read the TTS config from process.env. */
export function loadTtsConfig(): TtsConfig {
  return {
    modelDir: ttsModelDir(),
    steps: intEnv('TTS_STEPS', 8, 1),
    threads: intEnv('TTS_THREADS', 0, 0),
    maxQueue: intEnv('TTS_MAX_QUEUE', 8, 1),
    idleTimeoutSec: intEnv('TTS_IDLE_TIMEOUT_SEC', 600, 0),
  };
}
