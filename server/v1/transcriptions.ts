/** POST /api/v1/audio/transcriptions (OpenAI-compatible STT) and the unsupported /audio/translations. */
import { Elysia } from 'elysia';
import { newRequestId } from '../api-error';
import { AudioDecodeError, decodeTo16kMono } from '../audio/decode';
import { getStt } from '../engines/registry';
import type { SttEngine } from '../engines/types';
import { logger } from '../logger';
import { requireV1Caller } from './auth';
import { v1Config } from './config';
import { v1Error } from './errors';
import { readTranscriptionForm } from './transcriptions.form';
import { engineErrorResponse, formatResult, streamTranscript } from './transcriptions.output';

type LogMeta = { model?: string; bytes?: number; durationSec?: number; stream: boolean };

async function transcribe(request: Request, requestId: string, meta: LogMeta, onEnd: (s: number) => void): Promise<Response> {
  const input = await readTranscriptionForm(request);
  if (input instanceof Response) return input;
  Object.assign(meta, { model: input.model, bytes: input.file.size, stream: input.stream });

  let decoded: { audio: Float32Array; durationSec: number };
  try {
    decoded = await decodeTo16kMono(new Uint8Array(await input.file.arrayBuffer()), {
      mime: input.file.type,
      filename: input.file.name,
    });
  } catch (err) {
    if (err instanceof AudioDecodeError) return v1Error(400, err.message, { code: err.code, param: 'file' });
    throw err;
  }
  meta.durationSec = Math.round(decoded.durationSec * 100) / 100;
  if (decoded.durationSec > v1Config.maxAudioSec)
    return v1Error(400, `Audio is ${Math.round(decoded.durationSec)}s long; the limit is ${v1Config.maxAudioSec}s.`, {
      code: 'audio_too_long',
      param: 'file',
    });

  let engine: SttEngine;
  try {
    engine = getStt();
  } catch (err) {
    logger.error({ err, requestId }, 'stt engine not registered');
    return v1Error(503, 'The transcription engine is not available yet. Retry shortly.', { code: 'engine_unavailable' });
  }

  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  request.signal.addEventListener('abort', abort, { once: true });
  const req = {
    audio: decoded.audio,
    language: input.language,
    hotwords: input.hotwords.length ? input.hotwords : undefined,
    wordTimestamps: input.wordTimestamps,
  };

  if (input.stream)
    return streamTranscript({
      engine,
      req,
      ctrl,
      duration: decoded.durationSec,
      requestId,
      onEnd: (status) => {
        request.signal.removeEventListener('abort', abort);
        onEnd(status);
      },
    });

  try {
    const result = await engine.transcribe({ ...req, signal: ctrl.signal });
    return formatResult(result, input.responseFormat, result.duration || decoded.durationSec, input.wordTimestamps);
  } catch (err) {
    if (ctrl.signal.aborted) return v1Error(400, 'Request was cancelled by the client.', { code: 'request_aborted' });
    return engineErrorResponse(err, requestId);
  } finally {
    request.signal.removeEventListener('abort', abort);
  }
}

/** Runs the request and writes exactly one `stt transcription` info log (never the transcript). */
async function handle(request: Request): Promise<Response> {
  const t0 = performance.now();
  const requestId = request.headers.get('x-request-id') ?? newRequestId();
  const meta: LogMeta = { stream: false };
  let logged = false;
  const log = (status: number) => {
    if (logged) return;
    logged = true;
    logger.info({ requestId, ...meta, status, latencyMs: Math.round(performance.now() - t0) }, 'stt transcription');
  };

  const res = await transcribe(request, requestId, meta, log).catch((err: unknown) => {
    log(500);
    throw err;
  });
  res.headers.set('x-request-id', requestId);
  // A streamed 200 logs when the stream ends; everything else is complete now.
  if (!(meta.stream && res.status === 200)) log(res.status);
  return res;
}

/** OpenAI audio transcription routes. */
export const transcriptionsApi = new Elysia()
  .onBeforeHandle(requireV1Caller)
  .post('/audio/transcriptions', ({ request }) => handle(request), { parse: 'none' })
  .post(
    '/audio/translations',
    () =>
      v1Error(400, 'Audio translation is not supported by this server; use /audio/transcriptions.', {
        code: 'unsupported',
      }),
    { parse: 'none' },
  );
