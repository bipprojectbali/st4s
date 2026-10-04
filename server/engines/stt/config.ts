import os from 'node:os';
import path from 'node:path';

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

/** Read STT config from env; every value has a documented default. */
export function loadSttConfig(env: Record<string, string | undefined> = process.env): SttConfig {
  return {
    libPath: env.CRISPASR_LIB || path.join(os.homedir(), 'tmp/stt/build/src/libcrispasr.dylib'),
    modelPath: env.STT_MODEL || path.join(CACHE, 'qwen3-asr-1.7b-q4_k.gguf'),
    vadModelPath: env.STT_VAD_MODEL ?? path.join(CACHE, 'ggml-silero-v6.2.0.bin'),
    lidModelPath: env.STT_LID_MODEL || path.join(CACHE, 'ggml-tiny.bin'),
    threads: Math.max(1, int(env.STT_THREADS, 4)),
    useGpu: /^(1|true|yes|on)$/i.test(env.STT_GPU ?? ''),
    defaultLanguage: env.STT_DEFAULT_LANGUAGE || 'id',
    maxChunkSec: Math.max(1, int(env.STT_MAX_CHUNK_SEC, 30)),
    maxQueue: int(env.STT_MAX_QUEUE, 4),
    idleTimeoutSec: int(env.STT_IDLE_TIMEOUT_SEC, 600),
  };
}
