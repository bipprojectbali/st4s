/** Transcribes one committed realtime turn through the normal STT path (guard, queue, engine) and reports it. */
import { recordUsage } from '../api-keys/usage';
import { isEngineUnloadedError } from '../engines/errors';
import { EngineBusyError, type SttEngine } from '../engines/types';
import type { logger } from '../logger';
import { admissionMessage, admitSpeechWork } from '../memory-guard/plugin';
import { guardHandle } from '../memory-guard/state';
import { RT_SR } from './realtime-audio';
import { CLOSE } from './realtime-config';
import { hotwordsOf, type RtProblem, type RtSessionConfig, serverEvent } from './realtime-protocol';
import type { RtContext } from './realtime-session';
import { queueFullError } from './transcriptions.limits';
import { usage } from './transcriptions.output';

export type TurnDeps = {
  engine: SttEngine;
  ctx: RtContext;
  log: typeof logger;
  config(): RtSessionConfig;
  send(ev: object): void;
  shut(p: RtProblem, code: number, type?: string): void;
};

const busy = (sec: number) => `Mesin STT sibuk. Coba lagi dalam ${sec} detik.`;
const LOW_RAM = {
  code: 'memory_pressure',
  message: 'RAM server menipis; sesi ditutup. Coba lagi nanti.',
};

/** `run` never throws: every outcome is a .completed or .failed event plus one log line and usage row. */
export function createTurnRunner(d: TurnDeps) {
  const inflight = new Set<AbortController>();

  async function run(itemId: string, audio: Float32Array): Promise<void> {
    const t0 = performance.now();
    const sec = audio.length / RT_SR;
    const done = (status: number) => {
      const ms = Math.round(performance.now() - t0);
      d.log.info({ itemId, audioSec: Math.round(sec * 100) / 100, ms, status }, 'realtime turn');
      if (d.ctx.keyId)
        recordUsage({
          keyId: d.ctx.keyId,
          method: 'WS',
          path: '/api/v1/realtime',
          status,
          ip: d.ctx.ip,
          country: d.ctx.country,
          userAgent: d.ctx.userAgent,
          durationMs: ms,
        });
    };
    const failed = (code: string, message: string, status: number, type = 'server_error') => {
      d.send(
        serverEvent('conversation.item.input_audio_transcription.failed', {
          item_id: itemId,
          content_index: 0,
          error: { type, code, message, param: null },
        }),
      );
      done(status);
    };

    if (guardHandle()?.status().level === 'emergency') {
      failed('memory_pressure', 'RAM server kritis; transkripsi dibatalkan.', 503);
      d.shut(LOW_RAM, CLOSE.tryAgain, 'server_error');
      return;
    }
    const adm = admitSpeechWork('stt');
    if (!adm.ok) return failed('memory_pressure', admissionMessage(adm), 503);
    const full = queueFullError(d.engine);
    if (full) return failed('engine_busy', busy(full.retryAfterSec), 429, 'rate_limit_error');

    const ctrl = new AbortController();
    inflight.add(ctrl);
    const cfg = d.config();
    try {
      const r = await d.engine.transcribe({
        audio,
        language: cfg.language ?? undefined,
        hotwords: hotwordsOf(cfg),
        signal: ctrl.signal,
      });
      const base = { item_id: itemId, content_index: 0 };
      d.send(
        serverEvent('conversation.item.input_audio_transcription.delta', {
          ...base,
          delta: r.text,
        }),
      );
      d.send(
        serverEvent('conversation.item.input_audio_transcription.completed', {
          ...base,
          transcript: r.text,
          usage: usage(sec),
        }),
      );
      done(200);
    } catch (err) {
      if (ctrl.signal.aborted) return done(499);
      if (err instanceof EngineBusyError)
        return failed('engine_busy', busy(err.retryAfterSec), 429, 'rate_limit_error');
      if (isEngineUnloadedError(err)) {
        failed(
          'engine_unloaded',
          'Mesin STT dihentikan (RAM menipis atau idle). Ulangi giliran ini.',
          503,
        );
        const level = guardHandle()?.status().level;
        if (level === 'emergency' || level === 'critical')
          d.shut(LOW_RAM, CLOSE.tryAgain, 'server_error');
        return;
      }
      d.log.error({ err, itemId }, 'realtime transcription failed');
      failed('server_error', 'Transkripsi gagal. Coba lagi.', 500);
    } finally {
      inflight.delete(ctrl);
    }
  }

  return {
    run,
    /** Socket gone: cancel queued and running engine jobs. */
    abortAll(): void {
      for (const c of inflight) c.abort();
      inflight.clear();
    },
  };
}
