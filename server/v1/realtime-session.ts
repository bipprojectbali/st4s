/** One /api/v1/realtime transcription session: client events in, OpenAI Realtime events out. */
import { isEngineUnloadedError } from '../engines/errors';
import { hasVad } from '../engines/stt/vad';
import type { SttEngine } from '../engines/types';
import { logger } from '../logger';
import { createAppendDecoder, createAudioBuffer, RT_SR, toMs } from './realtime-audio';
import { CLOSE, rtConfig } from './realtime-config';
import {
  applySessionUpdate,
  type ClientEvent,
  defaultSessionConfig,
  errorEvent,
  newId,
  parseClientEvent,
  type RtProblem,
  serverEvent,
  sessionView,
} from './realtime-protocol';
import { createTurnRunner } from './realtime-turn';
import { createVadTracker } from './realtime-vad';

/** Who opened the session (ids and origin only — never content). */
export type RtContext = {
  sessionId: string;
  requestId: string;
  keyId: string | null;
  ip: string | null;
  country: string | null;
  userAgent: string | null;
  vadAvailable: boolean;
};

/** Socket side the session writes to. */
export type RtTransport = { send(ev: object): void; close(code: number, reason: string): void };

const MIN_COMMIT = RT_SR / 10;
const SUPPORTED =
  'session.update, input_audio_buffer.append, input_audio_buffer.commit, input_audio_buffer.clear';

/** Wire up a session; call `message` per text frame and `closed` once the socket is gone. */
export function createRealtimeSession(t: RtTransport, engine: SttEngine, ctx: RtContext) {
  const log = logger.child({ sessionId: ctx.sessionId, requestId: ctx.requestId });
  const openedAt = performance.now();
  let cfg = defaultSessionConfig(ctx.vadAvailable);
  const buf = createAudioBuffer();
  const decode = createAppendDecoder();
  let closed = false;
  let pendingItem: string | null = null;
  let lastItem: string | null = null;
  let turns = 0;

  const send = (ev: object) => {
    if (!closed) t.send(ev);
  };
  const fail = (p: RtProblem, eventId?: string | null) => send(errorEvent(p, eventId));
  const shut = (p: RtProblem, code: number, type?: string) => {
    if (closed) return;
    send(errorEvent(p, null, type));
    log.info({ code: p.code, closeCode: code }, 'realtime session closing');
    t.close(code, p.code);
    closed = true;
  };
  const turnRunner = createTurnRunner({ engine, ctx, log, config: () => cfg, send, shut });

  const vad = createVadTracker({
    buf,
    config: () => cfg.turnDetection,
    vad: (audio, opts) => {
      if (!hasVad(engine)) throw new Error('STT engine has no VAD');
      return engine.vad(audio, opts);
    },
    started(from) {
      buf.drop(from);
      pendingItem = newId('item');
      send(
        serverEvent('input_audio_buffer.speech_started', {
          audio_start_ms: toMs(from),
          item_id: pendingItem,
        }),
      );
    },
    stopped(to) {
      send(
        serverEvent('input_audio_buffer.speech_stopped', {
          audio_end_ms: toMs(to),
          item_id: pendingItem,
        }),
      );
      commit(to);
    },
    failed(err) {
      if (isEngineUnloadedError(err)) return; // next append retries; the model reloads on demand
      log.error({ err }, 'realtime vad failed; turn detection off');
      cfg = { ...cfg, turnDetection: null };
      fail({
        code: 'vad_failed',
        message: 'Deteksi giliran (server_vad) gagal; sesi beralih ke commit manual.',
      });
      send(serverEvent('session.updated', { session: sessionView(ctx.sessionId, cfg) }));
    },
  });

  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const armIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(
      () =>
        shut(
          {
            code: 'idle_timeout',
            message: `Sesi ditutup: tidak ada event selama ${rtConfig.idleTimeoutSec} detik.`,
          },
          CLOSE.policy,
        ),
      rtConfig.idleTimeoutSec * 1000,
    );
  };
  const lifeTimer = setTimeout(
    () =>
      shut(
        {
          code: 'session_expired',
          message: `Sesi mencapai batas ${rtConfig.maxSessionSec} detik. Buka sesi baru.`,
        },
        CLOSE.policy,
      ),
    rtConfig.maxSessionSec * 1000,
  );

  function commit(to: number) {
    const audio = buf.slice(buf.start, to);
    buf.drop(to);
    vad.reset(to);
    const itemId = pendingItem ?? newId('item');
    pendingItem = null;
    send(
      serverEvent('input_audio_buffer.committed', { item_id: itemId, previous_item_id: lastItem }),
    );
    send(
      serverEvent('conversation.item.added', {
        previous_item_id: lastItem,
        item: {
          id: itemId,
          type: 'message',
          object: 'realtime.item',
          role: 'user',
          status: 'completed',
          content: [{ type: 'input_audio', transcript: null }],
        },
      }),
    );
    lastItem = itemId;
    turns++;
    void turnRunner.run(itemId, audio);
  }

  function append(ev: ClientEvent) {
    if (typeof ev.audio !== 'string')
      return fail(
        { code: 'invalid_value', message: '`audio` wajib berupa string base64.', param: 'audio' },
        ev.event_id,
      );
    let samples: Float32Array;
    try {
      samples = decode(ev.audio);
    } catch (err) {
      return fail(
        { code: 'invalid_audio', message: (err as Error).message, param: 'audio' },
        ev.event_id,
      );
    }
    buf.append(samples);
    if (buf.end - buf.start <= rtConfig.maxTurnSec * RT_SR) return vad.poke();
    if (cfg.turnDetection) {
      if (!vad.speaking) {
        pendingItem = newId('item');
        send(
          serverEvent('input_audio_buffer.speech_started', {
            audio_start_ms: toMs(buf.start),
            item_id: pendingItem,
          }),
        );
      }
      send(
        serverEvent('input_audio_buffer.speech_stopped', {
          audio_end_ms: toMs(buf.end),
          item_id: pendingItem,
        }),
      );
      return commit(buf.end);
    }
    fail(
      {
        code: 'turn_too_long',
        message: `Buffer audio melebihi ${rtConfig.maxTurnSec} detik tanpa commit; buffer dikosongkan.`,
      },
      ev.event_id,
    );
    clear();
  }

  function clear() {
    buf.drop(buf.end);
    vad.reset(buf.end);
    pendingItem = null;
    send(serverEvent('input_audio_buffer.cleared'));
  }

  function handle(ev: ClientEvent) {
    switch (ev.type) {
      case 'session.update': {
        const next = applySessionUpdate(cfg, ev.session, ctx.vadAvailable);
        if ('code' in next) return fail(next, ev.event_id);
        if (JSON.stringify(next.turnDetection) !== JSON.stringify(cfg.turnDetection)) {
          vad.reset(buf.start);
          pendingItem = null;
        }
        cfg = next;
        return send(serverEvent('session.updated', { session: sessionView(ctx.sessionId, cfg) }));
      }
      case 'input_audio_buffer.append':
        return append(ev);
      case 'input_audio_buffer.commit':
        if (buf.end - buf.start < MIN_COMMIT)
          return fail(
            {
              code: 'input_audio_buffer_commit_empty',
              message:
                'Buffer audio kosong atau kurang dari 100 ms; kirim audio dulu sebelum commit.',
            },
            ev.event_id,
          );
        return commit(buf.end);
      case 'input_audio_buffer.clear':
        return clear();
      default:
        return fail(
          {
            code: 'unsupported_event',
            message: `Event '${ev.type.slice(0, 64)}' tidak didukung: server ini hanya melayani sesi transkripsi (${SUPPORTED}).`,
            param: 'type',
          },
          ev.event_id,
        );
    }
  }

  return {
    /** Send session.created and start the timers. */
    open() {
      armIdle();
      log.info({ keyId: ctx.keyId, vad: !!cfg.turnDetection }, 'realtime session opened');
      send(serverEvent('session.created', { session: sessionView(ctx.sessionId, cfg) }));
    },
    message(raw: string | Buffer) {
      if (closed) return;
      armIdle();
      const ev = parseClientEvent(raw);
      if (!('type' in ev)) return fail(ev);
      handle(ev);
    },
    /** Reject the session right after open (e.g. unsupported ?intent). */
    reject(p: RtProblem) {
      shut(p, CLOSE.policy);
    },
    /** Socket closed: stop timers, abort queued work, release everything. */
    closed(code: number) {
      closed = true;
      clearTimeout(idleTimer);
      clearTimeout(lifeTimer);
      vad.close();
      turnRunner.abortAll();
      buf.drop(buf.end);
      log.info(
        { code, turns, ms: Math.round(performance.now() - openedAt) },
        'realtime session closed',
      );
    },
  };
}
