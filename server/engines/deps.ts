/** Boot-time check that the speech engines' files and ffmpeg exist (non-fatal; engines load lazily). */
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../logger';
import { loadSttConfig } from './stt/config';
import { ttsModelDir } from './tts/config';

/** One dependency: env name, whether it is present, and the path or what is missing. */
export type EngineDep = { name: string; ok: boolean; detail: string };

/** Injection points for tests; defaults are process.env, fs.existsSync and Bun.which. */
export type DepsProbe = {
  env?: Record<string, string | undefined>;
  exists?: (p: string) => boolean;
  which?: (bin: string) => string | null;
};

const fileDep = (name: string, p: string, exists: (p: string) => boolean): EngineDep =>
  exists(p) ? { name, ok: true, detail: p } : { name, ok: false, detail: `tidak ditemukan: ${p}` };

/** Check every external file the STT/TTS engines and the ffmpeg encoder/decoder need. */
export function checkEngineDeps(probe: DepsProbe = {}): EngineDep[] {
  const env = probe.env ?? process.env;
  const exists = probe.exists ?? fs.existsSync;
  const which = probe.which ?? ((bin: string) => Bun.which(bin));
  const stt = loadSttConfig(env);
  const ttsDir = ttsModelDir(env);
  const ttsMissing = ['onnx', 'voice_styles']
    .map((d) => path.join(ttsDir, d))
    .filter((p) => !exists(p));
  const ffmpeg = env.FFMPEG_PATH || 'ffmpeg';
  const ffmpegAt = which(ffmpeg);
  return [
    fileDep('CRISPASR_LIB', stt.libPath, exists),
    fileDep('STT_MODEL', stt.modelPath, exists),
    stt.vadModelPath
      ? fileDep('STT_VAD_MODEL', stt.vadModelPath, exists)
      : { name: 'STT_VAD_MODEL', ok: true, detail: 'nonaktif (STT_VAD_MODEL kosong)' },
    fileDep('STT_LID_MODEL', stt.lidModelPath, exists),
    ttsMissing.length
      ? { name: 'TTS_MODEL_DIR', ok: false, detail: `tidak ditemukan: ${ttsMissing.join(', ')}` }
      : { name: 'TTS_MODEL_DIR', ok: true, detail: ttsDir },
    ffmpegAt
      ? { name: 'FFMPEG_PATH', ok: true, detail: ffmpegAt }
      : {
          name: 'FFMPEG_PATH',
          ok: false,
          detail: `tidak ditemukan: ${ffmpeg} (format selain wav/pcm ditolak)`,
        },
  ];
}

/** Log one line per missing dependency: `error` in production, `warn` elsewhere. Returns the missing count. */
export function logEngineDeps(deps: EngineDep[], production: boolean): number {
  const missing = deps.filter((d) => !d.ok);
  for (const d of missing) {
    const fields = { dep: d.name, detail: d.detail };
    if (production) logger.error(fields, 'engine dependency missing');
    else logger.warn(fields, 'engine dependency missing');
  }
  return missing.length;
}
