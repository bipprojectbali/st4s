import os from 'node:os';
import path from 'node:path';
import { CRISPASR_LIB_FILE, st4sLibDir, st4sModelsDir } from '../../st4s-home';

/** STT engine settings resolved from env (see defaults below). */
export interface SttConfig {
  libPath: string;
  modelPath: string;
  /** Silero VAD model used to slice audio; '' disables slicing (one pass, single delta). */
  vadModelPath: string;
  /** Whisper ggml model used for language ID when language is 'auto'. */
  lidModelPath: string;
  threads: number;
  /** Metal/GPU decode. Off by default: on Apple Silicon the GPU path wires both GGUF copies (see README Memori). */
  useGpu: boolean;
  defaultLanguage: string;
  /** Upper bound of one VAD slice in seconds (bounds decoder memory). */
  maxChunkSec: number;
  maxQueue: number;
  idleTimeoutSec: number;
}

const CACHE = path.join(os.homedir(), '.cache/crispasr');

function int(v: string | undefined, def: number): number {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : def;
}

/** The lib scripts/crispasr/build.sh builds; cwd is the project dir in dev, `bun run start` and the binary (which also reads .env from cwd). */
export function defaultCrispasrLib(cwd: string = process.cwd()): string {
  return path.resolve(cwd, '.crispasr/build/src/libcrispasr.dylib');
}

/** Read STT config from env; each path: explicit var > ST4S_HOME layout > dev default. */
export function loadSttConfig(env: Record<string, string | undefined> = process.env): SttConfig {
  const lib = st4sLibDir(env);
  const modelsDir = st4sModelsDir(env);
  const model = (file: string) => path.join(modelsDir ? path.join(modelsDir, 'stt') : CACHE, file);
  return {
    libPath: env.CRISPASR_LIB || (lib ? path.join(lib, CRISPASR_LIB_FILE) : defaultCrispasrLib()),
    modelPath: env.STT_MODEL || model('qwen3-asr-1.7b-q4_k.gguf'),
    vadModelPath: env.STT_VAD_MODEL ?? model('ggml-silero-v6.2.0.bin'),
    lidModelPath: env.STT_LID_MODEL || model('ggml-tiny.bin'),
    threads: Math.max(1, int(env.STT_THREADS, 4)),
    useGpu: /^(1|true|yes|on)$/i.test(env.STT_GPU ?? ''),
    defaultLanguage: env.STT_DEFAULT_LANGUAGE || 'id',
    maxChunkSec: Math.max(1, int(env.STT_MAX_CHUNK_SEC, 30)),
    maxQueue: int(env.STT_MAX_QUEUE, 4),
    idleTimeoutSec: int(env.STT_IDLE_TIMEOUT_SEC, 600),
  };
}
