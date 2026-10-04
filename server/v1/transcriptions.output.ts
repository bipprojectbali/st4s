/** Transcription results in OpenAI response formats: json/text/srt/vtt/verbose_json and the SSE stream. */
import { EngineBusyError, type SttEngine, type TranscribeRequest, type TranscribeResult } from '../engines/types';
import { logger } from '../logger';
import { v1Error, v1ErrorBody } from './errors';
import { toSrt, toVtt } from './subtitles';
import type { ResponseFormat } from './transcriptions.form';

/** OpenAI bills audio per started second; `usage` mirrors that. */
export const usage = (seconds: number) => ({ type: 'duration' as const, seconds: Math.ceil(seconds) });

const plain = (body: string, type = 'text/plain; charset=utf-8') =>
  new Response(body, { headers: { 'content-type': type, 'cache-control': 'no-store' } });

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

function verbose(r: TranscribeResult, duration: number, withWords: boolean) {
  const segments = r.segments.map((s) => ({
    id: s.id,
    seek: 0,
    start: s.start,
    end: s.end,
    text: s.text,
    tokens: [] as number[],
    temperature: 0,
    avg_logprob: 0,
    compression_ratio: 0,
    no_speech_prob: 0,
  }));
  const words = r.segments.flatMap((s) => (s.words ?? []).map(({ word, start, end }) => ({ word, start, end })));
  return {
    task: 'transcribe' as const,
    language: r.language,
    duration,
    text: r.text,
    segments,
    ...(withWords ? { words } : {}),
    usage: usage(duration),
  };
}

/** Non-streamed response body in the requested format. */
export function formatResult(r: TranscribeResult, format: ResponseFormat, duration: number, withWords: boolean): Response {
  switch (format) {
    case 'text':
      return plain(r.text);
    case 'srt':
      return plain(toSrt(r.segments));
    case 'vtt':
      return plain(toVtt(r.segments), 'text/vtt; charset=utf-8');
    case 'verbose_json':
      return json(verbose(r, duration, withWords));
    default:
      return json({ text: r.text, usage: usage(duration) });
  }
}

/** Busy -> 429 + Retry-After; anything else -> 500 without internals. */
export function engineErrorResponse(err: unknown, requestId: string): Response {
  if (err instanceof EngineBusyError)
    return v1Error(429, 'Mesin STT sedang penuh. Coba lagi beberapa detik lagi.', {
      code: 'engine_busy',
      headers: { 'retry-after': String(err.retryAfterSec) },
    });
  logger.error({ err, requestId }, 'stt transcription failed');
  return v1Error(500, 'Transkripsi gagal. Coba lagi; sertakan header x-request-id bila melapor.', {
    code: 'server_error',
  });
}

const sse = (obj: unknown) => new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`);

type StreamArgs = {
  engine: SttEngine;
  req: Omit<TranscribeRequest, 'onDelta' | 'signal'>;
  ctrl: AbortController;
  duration: number;
  requestId: string;
  onEnd: (status: number) => void;
};

/**
 * SSE in OpenAI's transcript.text.delta / transcript.text.done events. Headers wait for the first
 * delta (or the result), so busy/failure before any text is still a plain JSON error response.
 */
export async function streamTranscript({ engine, req, ctrl, duration, requestId, onEnd }: StreamArgs): Promise<Response> {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  let sentDelta = false;
  const push = (obj: unknown) => {
    if (!closed) controller.enqueue(sse(obj));
  };
  const close = () => {
    if (closed) return;
    closed = true;
    controller.close();
  };
  const body = new ReadableStream<Uint8Array>({
    start: (c) => {
      controller = c;
    },
    cancel: () => {
      closed = true;
      ctrl.abort();
    },
  });

  let firstDelta!: () => void;
  const gotDelta = new Promise<void>((resolve) => (firstDelta = resolve));
  const run = engine.transcribe({
    ...req,
    signal: ctrl.signal,
    onDelta: (delta) => {
      if (!delta) return;
      sentDelta = true;
      push({ type: 'transcript.text.delta', delta });
      firstDelta();
    },
  });

  const early = await Promise.race([gotDelta.then(() => null), run.then(() => null, (err: unknown) => ({ err }))]);
  if (early) return engineErrorResponse(early.err, requestId);

  run.then(
    (r) => {
      if (!sentDelta && r.text) push({ type: 'transcript.text.delta', delta: r.text });
      push({ type: 'transcript.text.done', text: r.text, usage: usage(duration) });
      close();
      onEnd(200);
    },
    (err: unknown) => {
      if (!ctrl.signal.aborted) logger.error({ err, requestId }, 'stt stream failed mid-way');
      push(v1ErrorBody(500, 'Transkripsi terhenti di tengah stream. Coba lagi.', 'server_error'));
      close();
      onEnd(ctrl.signal.aborted ? 499 : 500);
    },
  );
  return new Response(body, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' },
  });
}
