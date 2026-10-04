import { existsSync } from 'node:fs';
import path from 'node:path';
import { logger } from '../../logger';
import { EngineNotReadyError, EngineUnloadedError, VadFailedError } from '../errors';
import type { EngineState, SttEngine, TranscribeRequest, TranscribeResult } from '../types';
import { loadSttConfig, type SttConfig } from './config';
import { type SttChild, type SttSpawner, spawnBunChild } from './host';
import { abortError, type Job, queueBusyError, rejectOnAbort } from './jobs';
import type { FromChild } from './protocol';
import { createSttProbe, runSttSelfTest } from './selftest';
import { selfTestEnabled } from './selftest-env';
import { RollingStats } from './stats';
import { createVadBridge, isVadReply, type SttVad } from './vad';

/** Options for createSttEngine; everything defaults from env. */
export interface SttEngineOptions {
  config?: Partial<SttConfig>;
  spawn?: SttSpawner;
  /** Run the load-time self-test; defaults to selfTestEnabled() (off for injected spawners). */
  selfTest?: boolean;
}

/** Qwen3-ASR engine: one child process, serial FIFO queue, lazy load, idle unload, crash respawn. */
export function createSttEngine(opts: SttEngineOptions = {}): SttEngine & Partial<SttVad> {
  const cfg: SttConfig = { ...loadSttConfig(), ...opts.config };
  const spawn = opts.spawn ?? spawnBunChild();
  const selfTest = opts.selfTest ?? selfTestEnabled(!!opts.spawn);
  const log = logger.child({ engine: 'stt' });
  const stats = new RollingStats();
  const queue: Job[] = [];
  let current: Job | null = null;
  let child: SttChild | null = null;
  let ready: Promise<void> | null = null;
  let settleReady: { ok(): void; fail(e: Error): void } | null = null;
  let exited: (() => void) | null = null;
  let unloading: Promise<void> | null = null;
  let state: EngineState = 'unloaded';
  let loadedAt: string | null = null;
  let lastError: string | null = null;
  let rss: number | null = null;
  /** State to settle in when we caused the child's exit (unload / failed load). */
  let expectedExit: EngineState | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let nextId = 1;

  function markReady() {
    loadedAt = new Date().toISOString();
    state = 'ready';
    settleReady?.ok();
  }

  /** The child loaded wrong or not at all: stay in `error`, fail waiters with 503, stop the child. */
  function refuse(reason: string) {
    log.error({ reason }, 'stt engine not ready');
    lastError = reason;
    expectedExit = 'error';
    state = 'error';
    settleReady?.fail(new EngineNotReadyError('stt', reason));
    child?.kill();
  }

  function onMessage(m: FromChild) {
    if (probe.take(m)) return;
    if (isVadReply(m)) return vadBridge.onMessage(m);
    if (m.t === 'ready') {
      rss = m.rss;
      log.info(
        { loadMs: Math.round(m.loadMs), rss: m.rss, backend: m.backend, gpu: m.gpu },
        'stt model loaded',
      );
      if (!selfTest) return markReady();
      const c = child;
      void runSttSelfTest(probe, { vad: !!cfg.vadModelPath, log }).then((reason) => {
        if (child !== c) return;
        if (reason) refuse(reason);
        else markReady();
      });
      return;
    }
    if (m.t === 'load_error') return refuse(m.message);
    const job = current;
    if (!job || job.id !== m.id) return;
    if (m.t === 'delta') {
      if (job.dropped || !job.req.onDelta) return;
      try {
        job.req.onDelta(m.text);
      } catch (e) {
        log.warn({ id: job.id, err: (e as Error).message }, 'stt onDelta handler threw');
      }
      return;
    }
    rss = m.rss;
    current = null;
    state = 'ready';
    const ms = performance.now() - job.startedAt;
    if (m.t === 'cancelled') {
      log.info({ id: job.id, ms: Math.round(ms) }, 'stt cancelled between spans');
    } else if (m.t === 'result') {
      stats.ok(ms, m.result.duration);
      log.info(
        {
          ms: Math.round(ms),
          audioSec: m.result.duration,
          segments: m.result.segments.length,
          dropped: job.dropped,
        },
        'stt done',
      );
      if (!job.dropped) job.resolve(m.result);
    } else {
      stats.fail();
      lastError = `STT transcription failed: ${m.message}`;
      if (!job.dropped)
        job.reject(m.code === 'vad_failed' ? new VadFailedError(lastError) : new Error(lastError));
    }
    pump();
  }

  function onExit(code: number | null, signal: string | null) {
    child = null;
    ready = null;
    rss = null;
    loadedAt = null;
    unloading = null;
    exited?.();
    exited = null;
    // Only a job already sent to the child dies with it; one still waiting on load is failed by pump().
    const sent = current && current.startedAt > 0 ? current : null;
    if (sent) current = null;
    let err: Error;
    if (expectedExit) {
      state = expectedExit;
      expectedExit = null;
      err = new EngineUnloadedError('stt');
    } else {
      const msg = `STT child process exited unexpectedly (code ${code}, signal ${signal})`;
      lastError = msg;
      err = state === 'loading' ? new EngineNotReadyError('stt', msg) : new Error(msg);
      state = 'error';
      log.error({ code, signal, inFlight: sent?.id ?? null }, 'stt child crashed');
    }
    settleReady?.fail(err);
    probe.failAll(err);
    vadBridge.failAll(err);
    if (sent) {
      stats.fail();
      if (!sent.dropped) sent.reject(err);
    }
    void pump();
  }

  function ensureChild(): Promise<void> {
    if (ready) return ready;
    state = 'loading';
    const p = new Promise<void>((ok, no) => {
      settleReady = {
        ok: () => {
          settleReady = null;
          ok();
        },
        fail: (e) => {
          settleReady = null;
          no(e);
        },
      };
    });
    ready = p;
    try {
      child = spawn(cfg, { message: onMessage, exit: onExit });
    } catch (e) {
      ready = null;
      state = 'error';
      lastError = `Failed to start STT child: ${(e as Error).message}`;
      log.error({ reason: lastError }, 'stt engine not ready');
      settleReady?.fail(new EngineNotReadyError('stt', lastError));
    }
    return p;
  }

  function armIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    if (!cfg.idleTimeoutSec || current || queue.length || !child) return;
    idleTimer = setTimeout(() => {
      log.info({ idleSec: cfg.idleTimeoutSec }, 'stt idle unload');
      void unload();
    }, cfg.idleTimeoutSec * 1000);
    idleTimer.unref?.();
  }

  async function pump(): Promise<void> {
    // While the old child is exiting, new jobs wait; onExit pumps them onto a fresh child.
    if (current || unloading) return;
    const job = queue.shift();
    if (!job) return armIdle();
    current = job;
    if (idleTimer) clearTimeout(idleTimer);
    try {
      await ensureChild();
    } catch (e) {
      current = null;
      stats.fail();
      job.reject(e);
      // A failed child is still exiting; onExit pumps the rest onto a fresh one.
      return child ? undefined : pump();
    }
    if (job.dropped) {
      current = null;
      return pump();
    }
    state = 'busy';
    job.startedAt = performance.now();
    const language = job.req.language ?? cfg.defaultLanguage;
    if (!child) throw new Error(`STT child missing after ready for job ${job.id}`);
    child.send({
      t: 'transcribe',
      id: job.id,
      audio: job.req.audio,
      language,
      hotwords: job.req.hotwords ?? [],
      words: !!job.req.wordTimestamps,
    });
  }

  function transcribe(req: TranscribeRequest): Promise<TranscribeResult> {
    if (req.signal?.aborted) return Promise.reject(abortError(req.signal));
    if (queue.length >= cfg.maxQueue) return Promise.reject(queueBusyError(stats, queue.length));
    return new Promise<TranscribeResult>((resolve, reject) => {
      const job: Job = { id: nextId++, req, resolve, reject, dropped: false, startedAt: 0 };
      rejectOnAbort(
        job,
        req.signal,
        queue,
        () => current,
        (id) => child?.send({ t: 'cancel', id }),
      );
      queue.push(job);
      void pump();
    });
  }

  /** Rejects queued jobs now and the in-flight one on exit, so nothing respawns for them. Concurrent callers share one unload. */
  function unload(): Promise<void> {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    const dropped = queue.splice(0);
    if (dropped.length) {
      const err = new EngineUnloadedError('stt');
      for (const job of dropped) job.reject(err);
      log.info({ dropped: dropped.length }, 'stt unload rejected queued jobs');
    }
    if (unloading) return unloading;
    if (!child) return Promise.resolve();
    const c = child;
    unloading = new Promise<void>((r) => {
      exited = r;
      expectedExit = 'unloaded';
      c.kill();
    });
    return unloading;
  }

  const probe = createSttProbe((m) => {
    child?.send(m);
    return !!child;
  });

  // warmup() also re-arms the idle timer, so VAD traffic keeps the child loaded mid-session.
  const vadBridge = createVadBridge({
    ensure: warmup,
    send: (m) => {
      child?.send(m);
      return !!child;
    },
  });

  async function warmup(): Promise<void> {
    await unloading;
    await ensureChild();
    armIdle();
  }

  return {
    transcribe,
    // Realtime server_vad is offered only when the Silero model is actually on disk.
    ...(cfg.vadModelPath && existsSync(cfg.vadModelPath) ? { vad: vadBridge.vad } : {}),
    warmup,
    unload,
    status: () => ({
      kind: 'stt',
      model: path.basename(cfg.modelPath, '.gguf'),
      state,
      queued: queue.length,
      loadedAt: child ? loadedAt : null,
      lastError,
      rssBytes: rss,
      stats: stats.snapshot(),
    }),
  };
}
