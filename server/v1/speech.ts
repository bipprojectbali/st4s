import { Elysia } from 'elysia';
import { newRequestId } from '../api-error';
import { CONTENT_TYPES, NATIVE_FORMATS } from '../audio/encode';
import { ffmpegAvailable } from '../audio/encode-ffmpeg';
import { getTts } from '../engines/registry';
import { EngineBusyError, type TtsEngine } from '../engines/types';
import { logger } from '../logger';
import { speechUnits } from '../text/speech-units';
import { requireV1Caller } from './auth';
import { v1Config } from './config';
import { v1Error } from './errors';
import { speechConfig } from './speech-config';
import { parseSpeechParams } from './speech-params';
import { encodeUnits, responseBody, type SynthStats, synthUnits } from './speech-stream';

const ms = (from: number, to: number | null = performance.now()) =>
  to === null ? null : Math.round(to - from);

async function speak(request: Request, body: unknown): Promise<Response> {
  const t0 = performance.now();
  const requestId = request.headers.get('x-request-id') ?? newRequestId();
  const params = parseSpeechParams(body);
  if (params instanceof Response) return params;

  if (!NATIVE_FORMATS.includes(params.format) && !ffmpegAvailable(v1Config.ffmpegPath))
    return v1Error(400, `Format ${params.format} butuh ffmpeg yang tidak terpasang di server; pakai wav atau pcm.`, {
      code: 'unsupported_format',
      param: 'response_format',
    });

  let engine: TtsEngine;
  let sampleRate: number;
  try {
    engine = getTts();
    // Reads onnx/tts.json; a missing TTS_MODEL_DIR is a server-side outage (503), not a 500.
    sampleRate = engine.sampleRate;
  } catch (err) {
    logger.error({ err, requestId }, 'tts engine unavailable');
    return v1Error(503, 'Mesin TTS belum siap. Coba lagi sebentar lagi.', { code: 'engine_unavailable' });
  }
  if (!engine.voices().includes(params.voice))
    return v1Error(400, `Voice ${params.voiceName} tidak tersedia di mesin TTS.`, { code: 'invalid_value', param: 'voice' });

  const units = speechUnits(params.input, { maxChars: speechConfig.maxUnitChars });
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  request.signal.addEventListener('abort', abort, { once: true });
  const base = { voice: params.voice, language: params.language, speed: params.speed, steps: params.steps };

  // The first unit is awaited before any header goes out, so busy/failure can still be a clean error.
  let first: Float32Array;
  try {
    first = await engine.synthesize({ ...base, text: units[0], signal: ctrl.signal });
  } catch (err) {
    request.signal.removeEventListener('abort', abort);
    if (err instanceof EngineBusyError)
      return v1Error(429, 'Mesin TTS sedang penuh. Coba lagi beberapa detik lagi.', {
        code: 'engine_busy',
        headers: { 'retry-after': String(err.retryAfterSec) },
      });
    if (ctrl.signal.aborted) {
      logger.info({ requestId, units: units.length, totalMs: ms(t0) }, 'tts request aborted before first audio');
      return v1Error(400, 'Request dibatalkan oleh klien.', { code: 'request_aborted' });
    }
    logger.error({ err, requestId }, 'tts synthesis failed');
    return v1Error(500, 'Sintesis suara gagal. Coba lagi.', { code: 'tts_failed' });
  }

  const stats: SynthStats = { samples: 0, unitsDone: 0, failed: false };
  const clips = synthUnits({ engine, units, first, base, signal: ctrl.signal, stats, requestId });
  const knownSamples = units.length === 1 ? first.length : null;
  const bytes = encodeUnits(params, sampleRate, clips, ctrl.signal, knownSamples);
  const stream = responseBody({
    bytes,
    sse: params.streamFormat === 'sse',
    chars: params.input.length,
    abort,
    onEnd: ({ ttfbAt, aborted }) => {
      request.signal.removeEventListener('abort', abort);
      logger.info(
        {
          requestId,
          chars: params.input.length,
          voice: params.voiceName,
          format: params.format,
          stream: params.streamFormat,
          units: units.length,
          unitsDone: stats.unitsDone,
          audioSec: Math.round((stats.samples / sampleRate) * 100) / 100,
          ttfbMs: ms(t0, ttfbAt),
          totalMs: ms(t0),
          aborted: aborted || ctrl.signal.aborted,
          failed: stats.failed,
        },
        'tts speech',
      );
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': params.streamFormat === 'sse' ? 'text/event-stream' : CONTENT_TYPES[params.format],
      'cache-control': 'no-store',
      'x-request-id': requestId,
    },
  });
}

/** POST /api/v1/audio/speech (OpenAI-compatible TTS, streamed as units finish). */
export const speechApi = new Elysia()
  .onBeforeHandle(requireV1Caller)
  .post('/audio/speech', ({ request, body }) => speak(request, body));
