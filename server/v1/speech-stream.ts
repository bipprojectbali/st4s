/** Synthesis loop (prefetch 1) and the streamed response body for /v1/audio/speech. */
import { encodeNative, floatToS16le } from '../audio/encode';
import { encodeFfmpeg } from '../audio/encode-ffmpeg';
import type { SpeakRequest, TtsEngine } from '../engines/types';
import { logger } from '../logger';
import { v1Config } from './config';
import { speechConfig } from './speech-config';
import type { SpeechParams } from './speech-params';

export type SynthStats = { samples: number; unitsDone: number; failed: boolean };

/**
 * Yield one Float32 clip per unit in order. Unit n+1 is synthesized while unit n
 * is being encoded/sent; nothing new starts once `signal` aborts. A failure after
 * the first unit ends the stream (headers are already sent) and logs a warning.
 */
export async function* synthUnits(opts: {
  engine: TtsEngine;
  units: string[];
  first: Float32Array;
  base: Omit<SpeakRequest, 'text' | 'signal'>;
  signal: AbortSignal;
  stats: SynthStats;
  requestId: string;
}): AsyncGenerator<Float32Array> {
  const { engine, units, base, signal, stats } = opts;
  const synth = (i: number) => engine.synthesize({ ...base, text: units[i], signal });
  let pending: Promise<Float32Array> | null = units.length > 1 && !signal.aborted ? synth(1) : null;
  let next = 2;
  try {
    stats.samples += opts.first.length;
    stats.unitsDone = 1;
    yield opts.first;
    while (pending) {
      const pcm = await pending;
      pending = next < units.length && !signal.aborted ? synth(next++) : null;
      stats.samples += pcm.length;
      stats.unitsDone++;
      yield pcm;
    }
  } catch (err) {
    if (!signal.aborted) {
      stats.failed = true;
      logger.warn(
        { err, requestId: opts.requestId, unit: stats.unitsDone, units: units.length },
        'tts synthesis failed mid-stream; ending response early',
      );
    }
  } finally {
    // Generator closed early: the in-flight prefetch is aborted via `signal`; observe its rejection.
    pending?.catch((err) => logger.debug({ err, requestId: opts.requestId }, 'tts prefetch dropped'));
  }
}

/** Encoded audio bytes for `params.format` from the unit clips. */
export function encodeUnits(
  params: SpeechParams,
  sampleRate: number,
  clips: AsyncIterable<Float32Array>,
  signal: AbortSignal,
  knownSamples: number | null,
): AsyncIterable<Uint8Array> {
  if (params.format === 'wav' || params.format === 'pcm')
    return encodeNative(params.format, sampleRate, clips, knownSamples);
  return encodeFfmpeg({
    bin: v1Config.ffmpegPath,
    format: params.format,
    sampleRate,
    pcm16: (async function* () {
      for await (const x of clips) yield floatToS16le(x);
    })(),
    signal,
    idleTimeoutMs: speechConfig.ffmpegIdleTimeoutMs,
  });
}

const enc = new TextEncoder();
const sse = (event: unknown) => enc.encode(`data: ${JSON.stringify(event)}\n\n`);

/** Usage for `speech.audio.done`; no tokenizer here, so input ≈ chars/4 and audio tokens are reported as 0. */
export function speechUsage(chars: number) {
  const input = Math.ceil(chars / 4);
  return { input_tokens: input, output_tokens: 0, total_tokens: input };
}

/**
 * Pull-based body: raw bytes (`audio`) or `speech.audio.delta`/`done` events (`sse`).
 * `onEnd` fires exactly once with the time to first byte and whether the client left.
 */
export function responseBody(opts: {
  bytes: AsyncIterable<Uint8Array>;
  sse: boolean;
  chars: number;
  abort: () => void;
  onEnd: (info: { ttfbAt: number | null; aborted: boolean }) => void;
}): ReadableStream<Uint8Array> {
  const it = opts.bytes[Symbol.asyncIterator]();
  let ttfbAt: number | null = null;
  let ended = false;
  const end = (aborted: boolean) => {
    if (ended) return;
    ended = true;
    opts.onEnd({ ttfbAt, aborted });
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        let r = await it.next();
        // A pull that enqueues nothing may never be re-invoked, so skip empty chunks here.
        while (!r.done && r.value.length === 0) r = await it.next();
        const { value, done } = r;
        if (done) {
          if (opts.sse) controller.enqueue(sse({ type: 'speech.audio.done', usage: speechUsage(opts.chars) }));
          controller.close();
          end(false);
          return;
        }
        ttfbAt ??= performance.now();
        controller.enqueue(
          opts.sse ? sse({ type: 'speech.audio.delta', audio: Buffer.from(value).toString('base64') }) : value,
        );
      } catch (err) {
        logger.warn({ err }, 'tts response stream failed');
        controller.error(err);
        end(false);
      }
    },
    async cancel() {
      opts.abort();
      end(true);
      await it.return?.();
    },
  });
}
