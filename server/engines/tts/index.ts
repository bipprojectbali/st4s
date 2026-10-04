import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../../logger';
import { TTS_MODEL_ID } from '../../v1/aliases';
import { EngineNotReadyError, EngineUnloadedError } from '../errors';
import { selfTestEnabled } from '../stt/selftest-env';
import {
  EngineBusyError,
  type EngineState,
  type EngineStatus,
  type SpeakRequest,
  type TtsEngine,
} from '../types';
import { loadTtsConfig, type TtsConfig } from './config';
import type { ChildMsg } from './protocol';
import { startTtsSelfTest } from './selftest';
import { bunSpawner, type ChildHandle, type Spawner } from './spawner';
import { RollingStats } from './stats';
import { isTtsLanguage } from './text';

interface Job {
  id: number;
  req: SpeakRequest;
  steps: number;
  settled: boolean;
  startedAt: number;
  resolve(pcm: Float32Array): void;
  reject(err: unknown): void;
}

/** Options for createTtsEngine; everything defaults to env config and a real Bun child. */
export interface TtsEngineOptions {
  config?: Partial<TtsConfig>;
  spawn?: Spawner;
  /** Run the load-time self-test; defaults to selfTestEnabled() (off for injected spawners). */
  selfTest?: boolean;
}

class SupertonicEngine implements TtsEngine {
  private child: ChildHandle | null = null;
  private loading: Promise<void> | null = null;
  private unloading: Promise<void> | null = null;
  private loader: { resolve(): void; reject(e: Error): void } | null = null;
  private running: Job | null = null;
  private readonly queue: Job[] = [];
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private nextId = 1;
  private failed = false;
  private lastError: string | null = null;
  private loadedAt: string | null = null;
  private rss: number | null = null;
  private rate: number | null = null;
  private voiceList: string[] | null = null;
  private readonly stats = new RollingStats();
  private probe: { take(msg: ChildMsg): boolean } | null = null;

  constructor(
    private readonly cfg: TtsConfig,
    private readonly spawn: Spawner,
    private readonly selfTest: boolean,
  ) {}

  get sampleRate(): number {
    if (this.rate === null) {
      const file = path.join(this.cfg.modelDir, 'onnx', 'tts.json');
      try {
        this.rate = (
          JSON.parse(fs.readFileSync(file, 'utf8')) as { ae: { sample_rate: number } }
        ).ae.sample_rate;
      } catch (e) {
        throw new Error(`Cannot read TTS sample rate from ${file}: ${(e as Error).message}`);
      }
    }
    return this.rate;
  }

  voices(): readonly string[] {
    if (this.voiceList) return this.voiceList;
    const dir = path.join(this.cfg.modelDir, 'voice_styles');
    try {
      this.voiceList = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.slice(0, -5))
        .sort();
    } catch (e) {
      logger.warn({ dir, err: (e as Error).message }, 'tts: voice style dir unreadable');
      return [];
    }
    return this.voiceList;
  }

  status(): EngineStatus {
    return {
      kind: 'tts',
      model: TTS_MODEL_ID,
      state: this.state(),
      queued: this.queue.length,
      loadedAt: this.loadedAt,
      lastError: this.lastError,
      rssBytes: this.child ? this.rss : null,
      stats: this.stats.snapshot(),
    };
  }

  private state(): EngineState {
    if (this.loading) return 'loading';
    if (this.child) return this.running ? 'busy' : 'ready';
    return this.failed ? 'error' : 'unloaded';
  }

  async warmup(): Promise<void> {
    await this.unloading;
    await this.ensureLoaded();
    this.scheduleIdle();
  }

  /** Rejects queued and running jobs with EngineUnloadedError; jobs arriving later wait for the exit, then reload. */
  unload(): Promise<void> {
    this.clearIdle();
    const err = new EngineUnloadedError('tts');
    const dropped = this.queue.splice(0);
    for (const job of dropped) this.settle(job, err);
    if (this.unloading) return this.unloading;
    const child = this.child;
    if (!child) return Promise.resolve();
    this.child = null;
    this.loadedAt = null;
    this.failed = false;
    this.loader?.reject(err);
    if (this.running) {
      this.settle(this.running, err);
      this.running = null;
    }
    child.kill();
    const done = () => {
      this.unloading = null;
      logger.info({ dropped: dropped.length }, 'tts: child unloaded');
      this.pump();
    };
    this.unloading = child.exited.then(done, done);
    return this.unloading;
  }

  synthesize(req: SpeakRequest): Promise<Float32Array> {
    if (!req.text.trim()) return Promise.reject(new Error('TTS input text is empty'));
    if (!isTtsLanguage(req.language))
      return Promise.reject(new Error(`Unsupported TTS language "${req.language}"`));
    if (!this.voices().includes(req.voice))
      return Promise.reject(new Error(`Unknown TTS voice "${req.voice}"`));
    if (!(req.speed >= 0.25 && req.speed <= 4))
      return Promise.reject(new Error(`TTS speed ${req.speed} out of range 0.25–4`));
    const steps = req.steps ?? this.cfg.steps;
    if (!Number.isInteger(steps) || steps < 1)
      return Promise.reject(new Error(`TTS steps must be a positive integer`));
    if (req.signal?.aborted) return Promise.reject(req.signal.reason);
    if (this.queue.length >= this.cfg.maxQueue) {
      const perJobMs = this.stats.p50Ms ?? 5000;
      return Promise.reject(
        new EngineBusyError(
          'tts',
          Math.max(1, Math.ceil(((this.queue.length + 1) * perJobMs) / 1000)),
        ),
      );
    }

    return new Promise<Float32Array>((resolve, reject) => {
      const job: Job = {
        id: this.nextId++,
        req,
        steps,
        settled: false,
        startedAt: 0,
        resolve,
        reject,
      };
      req.signal?.addEventListener('abort', () => this.abort(job), { once: true });
      this.queue.push(job);
      this.pump();
    });
  }

  private abort(job: Job): void {
    const idx = this.queue.indexOf(job);
    if (idx >= 0) this.queue.splice(idx, 1);
    // A running job keeps its slot until the child answers; the answer is then discarded.
    this.settle(job, job.req.signal?.reason);
  }

  private settle(job: Job, result: Float32Array | unknown): void {
    if (job.settled) return;
    job.settled = true;
    if (result instanceof Float32Array) job.resolve(result);
    else job.reject(result);
  }

  private pump(): void {
    // A second child must not load while the unloaded one still holds its memory.
    if (this.running || this.unloading || this.queue.length === 0) return;
    if (!this.child || this.loading) {
      this.ensureLoaded().then(
        () => this.pump(),
        (e: Error) => {
          // unload() already rejected its jobs; anything queued since waits for the exit and reloads.
          if (e instanceof EngineUnloadedError) return;
          for (const job of this.queue.splice(0)) this.settle(job, e);
        },
      );
      return;
    }
    const job = this.queue.shift();
    if (!job) return;
    this.clearIdle();
    this.running = job;
    job.startedAt = performance.now();
    const { text, voice, language, speed } = job.req;
    this.child.send({ type: 'synth', id: job.id, text, voice, language, speed, steps: job.steps });
  }

  private ensureLoaded(): Promise<void> {
    if (this.loading) return this.loading;
    if (this.child) return Promise.resolve();
    this.loading = new Promise<void>((resolve, reject) => {
      this.loader = { resolve, reject };
    });
    const clear = () => {
      this.loading = null;
      this.loader = null;
    };
    this.loading.then(clear, clear);
    try {
      const handle: ChildHandle = this.spawn({
        onMessage: (msg) => this.onMessage(handle, msg),
        onExit: (code, signal) => this.onExit(handle, code, signal),
      });
      this.child = handle;
      handle.send({ type: 'load', modelDir: this.cfg.modelDir, threads: this.cfg.threads });
    } catch (e) {
      this.fail(`TTS child spawn failed: ${(e as Error).message}`);
    }
    return this.loading;
  }

  private fail(message: string): void {
    this.failed = true;
    this.lastError = message;
    this.loader?.reject(new EngineNotReadyError('tts', message));
    logger.error({ err: message }, 'tts: engine failure');
  }

  private onMessage(handle: ChildHandle, msg: ChildMsg): void {
    if (handle !== this.child) return;
    this.rss = msg.rss;
    if (this.probe?.take(msg)) return;
    if (msg.type === 'loaded') {
      this.failed = false;
      this.rate = msg.sampleRate;
      logger.info({ loadMs: Math.round(msg.loadMs), rss: msg.rss }, 'tts: model loaded');
      if (!this.selfTest) this.markLoaded();
      else
        this.probe = startTtsSelfTest(
          (m) => handle.send(m),
          { voice: this.voices()[0], steps: this.cfg.steps, sampleRate: msg.sampleRate },
          (reason) => {
            this.probe = null;
            if (handle !== this.child) return;
            if (reason) this.refuse(handle, reason);
            else this.markLoaded();
          },
        );
      return;
    }
    if (msg.type === 'error' && msg.id === undefined) {
      this.refuse(handle, msg.message);
      return;
    }
    const job = this.running;
    if (!job || job.id !== msg.id) return;
    this.running = null;
    const latencyMs = performance.now() - job.startedAt;
    if (msg.type === 'result') {
      const audioSec = msg.pcm.length / this.sampleRate;
      this.stats.success(latencyMs, audioSec);
      logger.info(
        { id: job.id, chars: job.req.text.length, latencyMs: Math.round(latencyMs), audioSec },
        'tts: synthesized',
      );
      this.settle(job, msg.pcm);
    } else {
      this.stats.failure();
      this.lastError = msg.message;
      logger.warn({ id: job.id, err: msg.message }, 'tts: synthesis failed');
      this.settle(job, new Error(msg.message));
    }
    this.pump();
    this.scheduleIdle();
  }

  private markLoaded(): void {
    this.loadedAt = new Date().toISOString();
    this.loader?.resolve();
  }

  private refuse(handle: ChildHandle, reason: string): void {
    this.child = null;
    handle.kill();
    this.fail(reason);
  }

  private onExit(handle: ChildHandle, code: number | null, signal: string | null): void {
    if (handle !== this.child) return;
    this.probe = null;
    this.child = null;
    this.loadedAt = null;
    this.fail(`TTS child exited unexpectedly (code ${code}, signal ${signal})`);
    if (this.running) {
      this.stats.failure();
      this.settle(this.running, new Error(this.lastError ?? 'TTS child exited unexpectedly'));
      this.running = null;
    }
    this.pump();
  }

  private scheduleIdle(): void {
    this.clearIdle();
    if (this.cfg.idleTimeoutSec <= 0 || this.running || this.queue.length || !this.child) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (!this.running && this.queue.length === 0) void this.unload();
    }, this.cfg.idleTimeoutSec * 1000);
    this.idleTimer.unref?.();
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
}

/** Create the Supertonic 3 TTS engine (lazy child process, serial FIFO queue). */
export function createTtsEngine(opts: TtsEngineOptions = {}): TtsEngine {
  return new SupertonicEngine(
    { ...loadTtsConfig(), ...opts.config },
    opts.spawn ?? bunSpawner,
    opts.selfTest ?? selfTestEnabled(!!opts.spawn),
  );
}
