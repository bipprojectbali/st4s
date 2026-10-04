// Ported from supertone-inc/supertonic nodejs/helper.js (MIT); model weights are OpenRAIL-M.
import fs from 'node:fs';
import path from 'node:path';
import * as ort from 'onnxruntime-node';
import { chunkText, maxChunkLen, preprocessText, textToIds } from './text';

const SILENCE_SEC = 0.3;

interface Style {
  ttl: ort.Tensor;
  dp: ort.Tensor;
}

interface StyleJson {
  style_ttl: { dims: number[]; data: unknown[] };
  style_dp: { dims: number[]; data: unknown[] };
}

/** Supertonic 3 inference over the four ONNX sessions (single speaker, batch size 1). */
export class Supertonic {
  readonly sampleRate: number;
  private readonly baseChunk: number;
  private readonly compress: number;
  private readonly latentDim: number;
  private readonly styles = new Map<string, Style>();

  private constructor(
    private readonly modelDir: string,
    cfg: { ae: { sample_rate: number; base_chunk_size: number }; ttl: { chunk_compress_factor: number; latent_dim: number } },
    private readonly indexer: readonly number[],
    private readonly dp: ort.InferenceSession,
    private readonly textEnc: ort.InferenceSession,
    private readonly vectorEst: ort.InferenceSession,
    private readonly vocoder: ort.InferenceSession,
  ) {
    this.sampleRate = cfg.ae.sample_rate;
    this.baseChunk = cfg.ae.base_chunk_size;
    this.compress = cfg.ttl.chunk_compress_factor;
    this.latentDim = cfg.ttl.latent_dim;
  }

  /** Load config, indexer and all four ONNX sessions from `<modelDir>/onnx`. */
  static async load(modelDir: string, threads: number): Promise<Supertonic> {
    const onnxDir = path.join(modelDir, 'onnx');
    const readJson = (f: string) => JSON.parse(fs.readFileSync(path.join(onnxDir, f), 'utf8'));
    const opts: ort.InferenceSession.SessionOptions = threads > 0 ? { intraOpNumThreads: threads } : {};
    const open = (f: string) => ort.InferenceSession.create(path.join(onnxDir, f), opts);
    const [dp, textEnc, vectorEst, vocoder] = await Promise.all([
      open('duration_predictor.onnx'),
      open('text_encoder.onnx'),
      open('vector_estimator.onnx'),
      open('vocoder.onnx'),
    ]);
    return new Supertonic(modelDir, readJson('tts.json'), readJson('unicode_indexer.json'), dp, textEnc, vectorEst, vocoder);
  }

  private style(voice: string): Style {
    const cached = this.styles.get(voice);
    if (cached) return cached;
    if (!/^[A-Za-z0-9_-]+$/.test(voice)) throw new Error(`Invalid voice id "${voice}"`);
    const file = path.join(this.modelDir, 'voice_styles', `${voice}.json`);
    const json = JSON.parse(fs.readFileSync(file, 'utf8')) as StyleJson;
    const tensor = (s: StyleJson['style_ttl']) =>
      new ort.Tensor('float32', Float32Array.from(s.data.flat(Infinity) as number[]), s.dims);
    const style = { ttl: tensor(json.style_ttl), dp: tensor(json.style_dp) };
    this.styles.set(voice, style);
    return style;
  }

  /** Synthesize `text` to mono PCM; long input is chunked and joined with short silences. */
  async synthesize(text: string, lang: string, voice: string, steps: number, speed: number): Promise<Float32Array> {
    const style = this.style(voice);
    const parts: Float32Array[] = [];
    const silence = new Float32Array(Math.floor(SILENCE_SEC * this.sampleRate));
    for (const chunk of chunkText(text, maxChunkLen(lang))) {
      if (parts.length) parts.push(silence);
      parts.push(await this.infer(chunk, lang, style, steps, speed));
    }
    const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const p of parts) {
      out.set(p, offset);
      offset += p.length;
    }
    return out;
  }

  private async infer(chunk: string, lang: string, style: Style, steps: number, speed: number): Promise<Float32Array> {
    const ids = textToIds(preprocessText(chunk, lang), this.indexer);
    const textIds = new ort.Tensor('int64', ids, [1, ids.length]);
    const textMask = new ort.Tensor('float32', new Float32Array(ids.length).fill(1), [1, 1, ids.length]);

    const { duration } = await this.dp.run({ text_ids: textIds, style_dp: style.dp, text_mask: textMask });
    const durationSec = (duration!.data as Float32Array)[0]! / speed;
    const { text_emb } = await this.textEnc.run({ text_ids: textIds, style_ttl: style.ttl, text_mask: textMask });

    const wavLen = Math.floor(durationSec * this.sampleRate);
    const chunkSize = this.baseChunk * this.compress;
    const latentLen = Math.max(1, Math.ceil(wavLen / chunkSize));
    const dim = this.latentDim * this.compress;
    let latent: Float32Array = gaussian(dim * latentLen);
    const shape = [1, dim, latentLen];
    const latentMask = new ort.Tensor('float32', new Float32Array(latentLen).fill(1), [1, 1, latentLen]);
    const totalStep = new ort.Tensor('float32', Float32Array.of(steps), [1]);

    for (let step = 0; step < steps; step++) {
      const { denoised_latent } = await this.vectorEst.run({
        noisy_latent: new ort.Tensor('float32', latent, shape),
        text_emb: text_emb!,
        style_ttl: style.ttl,
        text_mask: textMask,
        latent_mask: latentMask,
        total_step: totalStep,
        current_step: new ort.Tensor('float32', Float32Array.of(step), [1]),
      });
      latent = Float32Array.from(denoised_latent!.data as Float32Array);
    }

    const { wav_tts } = await this.vocoder.run({ latent: new ort.Tensor('float32', latent, shape) });
    const wav = wav_tts!.data as Float32Array;
    return wav.slice(0, Math.min(wav.length, wavLen));
  }
}

/** Standard-normal noise via Box–Muller (as upstream). */
export function gaussian(n: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u1 = Math.max(1e-10, Math.random());
    out[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * Math.random());
  }
  return out;
}
