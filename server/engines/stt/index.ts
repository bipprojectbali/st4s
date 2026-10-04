import path from 'node:path';
import { logger } from '../../logger';
import { EngineBusyError, type EngineState, type SttEngine, type TranscribeRequest, type TranscribeResult } from '../types';
import { loadSttConfig, type SttConfig } from './config';
import { spawnBunChild, type SttChild, type SttSpawner } from './host';
import type { FromChild } from './protocol';
import { RollingStats } from './stats';

/** Options for createSttEngine; everything defaults from env. */
export interface SttEngineOptions {
  config?: Partial<SttConfig>;
  spawn?: SttSpawner;
}

type Job = {
  id: number;
  req: TranscribeRequest;
  resolve(r: TranscribeResult): void;
  reject(e: unknown): void;
  /** Caller aborted after the child took it; the result is dropped on arrival. */
  dropped: boolean;
  startedAt: number;
};

const abortError = (s: AbortSignal) => s.reason ?? new DOMException('STT request aborted', 'AbortError');

/** Qwen3-ASR engine: one child process, serial FIFO queue, lazy load, idle unload, crash respawn. */
export function createSttEngine(opts: SttEngineOptions = {}): SttEngine {
  const cfg: SttConfig = { ...loadSttConfig(), ...opts.config };
  const spawn = opts.spawn ?? spawnBunChild();
  const log = logger.child({ engine: 'stt' });
  const stats = new RollingStats();
  const queue: Job[] = [];
  let current: Job | null = null;
  let child: SttChild | null = null;
  let ready: Promise<void> | null = null;
  let settleReady: { ok(): void; fail(e: Error): void } | null = null;
  let exited: (() => void) | null = null;
  let state: EngineState = 'unloaded';
  let loadedAt: string | null = null;
  let lastError: string | null = null;
  let rss: number | null = null;
  /** State to settle in when we caused the child's exit (unload / failed load). */
  let expectedExit: EngineState | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let nextId = 1;

  function fail(msg: string): Error {
    lastError = msg;
    return new Error(msg);
  }

  function onMessage(m: FromChild) {
    if (m.t === 'ready') {
      loadedAt = new Date().toISOString();
      rss = m.rss;
      state = 'ready';
      log.info({ loadMs: Math.round(m.loadMs), rss: m.rss, backend: m.backend, gpu: m.gpu }, 'stt model loaded');
      settleReady?.ok();
      return;
    }
    if (m.t === 'load_error') {
      expectedExit = 'error';
      state = 'error';
      settleReady?.fail(fail(m.message));
      child?.kill();
      return;
    }
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
    if (m.t === 'result') {
      stats.ok(ms, m.result.duration);
      log.info({ ms: Math.round(ms), audioSec: m.result.duration, segments: m.result.segments.length, dropped: job.dropped }, 'stt done');
      if (!job.dropped) job.resolve(m.result);
    } else {
      stats.fail();
      if (!job.dropped) job.reject(fail(`STT transcription failed: ${m.message}`));
    }
    pump();
  }

  function onExit(code: number | null, signal: string | null) {
    child = null;
    ready = null;
    rss = null;
    loadedAt = null;
    exited?.();
    exited = null;
    // Only a job already sent to the child dies with it; one still waiting on load is failed by pump().
    const sent = current && current.startedAt > 0 ? current : null;
    if (sent) current = null;
    let err: Error;
    if (expectedExit) {
      state = expectedExit;
      expectedExit = null;
      err = new Error('STT engine unloaded');
    } else {
      err = fail(`STT child process exited unexpectedly (code ${code}, signal ${signal})`);
      state = 'error';
      log.error({ code, signal, inFlight: sent?.id ?? null }, 'stt child crashed');
    }
    settleReady?.fail(err);
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
        ok: () => ((settleReady = null), ok()),
        fail: (e) => ((settleReady = null), no(e)),
      };
    });
    ready = p;
    try {
      child = spawn(cfg, { message: onMessage, exit: onExit });
    } catch (e) {
      ready = null;
      state = 'error';
      settleReady?.fail(fail(`Failed to start STT child: ${(e as Error).message}`));
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
    if (current) return;
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
    child!.send({ t: 'transcribe', id: job.id, audio: job.req.audio, language, hotwords: job.req.hotwords ?? [], words: !!job.req.wordTimestamps });
  }

  function transcribe(req: TranscribeRequest): Promise<TranscribeResult> {
    if (req.signal?.aborted) return Promise.reject(abortError(req.signal));
    if (queue.length >= cfg.maxQueue) {
      const p50 = stats.snapshot().p50Ms ?? 10_000;
      return Promise.reject(new EngineBusyError('stt', Math.max(1, Math.ceil((p50 / 1000) * (queue.length + 1)))));
    }
    return new Promise<TranscribeResult>((resolve, reject) => {
      const job: Job = { id: nextId++, req, resolve, reject, dropped: false, startedAt: 0 };
      // ponytail: a running decode cannot be interrupted over FFI; it finishes and its result is discarded.
      req.signal?.addEventListener(
        'abort',
        () => {
          const i = queue.indexOf(job);
          if (i >= 0) queue.splice(i, 1);
          else job.dropped = true;
          reject(abortError(req.signal!));
        },
        { once: true },
      );
      queue.push(job);
      void pump();
    });
  }

  async function unload(): Promise<void> {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    if (!child) return;
    const done = new Promise<void>((r) => (exited = r));
    expectedExit = 'unloaded';
    child.kill();
    await done;
  }

  async function warmup(): Promise<void> {
    await ensureChild();
    armIdle();
  }

  return {
    transcribe,
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
