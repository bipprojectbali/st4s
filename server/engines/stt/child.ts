/** STT child process: owns libcrispasr (sync FFI, may crash) so the server event loop never blocks on decode. */
import type { Pointer } from 'bun:ffi';
import { VadFailedError } from '../errors';
import type { SttConfig } from './config';
import { openCrispasr } from './ffi';
import type { FromChild, ToChild, TranscribeMsg, VadMsg } from './protocol';
import { SpanCancelledError, transcribePcm } from './spans';

type Opener = { openSession(modelPath: string, threads: number, useGpu: boolean): Pointer | null };

/** Open a session on the configured backend; GPU falls back to CPU, CPU-only never touches Metal. */
export function openSttSession(
  lib: Opener,
  cfg: Pick<SttConfig, 'modelPath' | 'threads' | 'useGpu'>,
): { s: Pointer; gpu: boolean } {
  for (const gpu of cfg.useGpu ? [true, false] : [false]) {
    const s = lib.openSession(cfg.modelPath, cfg.threads, gpu);
    if (s) return { s, gpu };
  }
  throw new Error(
    `crispasr session open failed for ${cfg.modelPath} (${cfg.useGpu ? 'GPU and CPU' : 'CPU'})`,
  );
}

/** Run the STT child loop; `cfgJson` is the serialized SttConfig the host passes on argv. */
export function runSttChild(cfgJson: string | undefined): void {
  const cfg = JSON.parse(cfgJson ?? '') as SttConfig;
  const send = (m: FromChild) => {
    if (!process.send) throw new Error('STT child started without an IPC channel');
    process.send(m);
  };
  const rss = () => process.memoryUsage().rss;
  // The child has no pino logger; stderr is inherited by the server log stream.
  const warn = (msg: string) => process.stderr.write(`[stt-child] warn: ${msg}\n`);

  function load() {
    const t0 = performance.now();
    const lib = openCrispasr(cfg.libPath);
    return { lib, ...openSttSession(lib, cfg), loadMs: performance.now() - t0 };
  }

  let eng: ReturnType<typeof load>;
  try {
    eng = load();
  } catch (e) {
    send({ t: 'load_error', message: `STT model load failed: ${(e as Error).message}` });
    process.exit(1);
  }
  send({
    t: 'ready',
    loadMs: eng.loadMs,
    rss: rss(),
    backend: eng.lib.backend(eng.s),
    gpu: eng.gpu,
  });

  // Yields so the queued IPC write leaves the process (and a cancel can arrive) before the next blocking FFI call.
  const flush = () => new Promise<void>((r) => setImmediate(r));
  const cancelled = new Set<number>();
  const warnedVad = new Set<string>();

  function transcribe(m: TranscribeMsg) {
    return transcribePcm({
      lib: eng.lib,
      session: eng.s,
      cfg,
      job: m,
      audio:
        m.audio instanceof Float32Array ? m.audio : new Float32Array(m.audio as ArrayLike<number>),
      onVadFallback: (kind, reason) => {
        if (warnedVad.has(kind)) return;
        warnedVad.add(kind);
        warn(reason);
      },
      onDelta: (delta) => send({ t: 'delta', id: m.id, text: delta }),
      isCancelled: () => cancelled.has(m.id),
      yieldNow: flush,
    });
  }

  function vad(m: VadMsg): FromChild {
    if (!cfg.vadModelPath)
      return { t: 'vad_error', id: m.id, message: 'VAD disabled (STT_VAD_MODEL empty)' };
    const audio =
      m.audio instanceof Float32Array ? m.audio : new Float32Array(m.audio as ArrayLike<number>);
    const opts = { threshold: m.threshold, minSilenceMs: m.minSilenceMs, padMs: 0 };
    const spans = eng.lib.vadSlices(cfg.vadModelPath, audio, 0, cfg.threads, opts);
    return spans
      ? { t: 'vad_result', id: m.id, spans }
      : { t: 'vad_error', id: m.id, message: `crispasr_vad_slices failed on ${cfg.vadModelPath}` };
  }

  let chain = Promise.resolve();
  process.on('message', (m: ToChild) => {
    if (m.t === 'cancel') {
      cancelled.add(m.id);
      return;
    }
    // ponytail: VAD runs outside the job chain, so it answers between spans; a span in flight (<= STT_MAX_CHUNK_SEC decode) delays it.
    if (m.t === 'vad') {
      try {
        send(vad(m));
      } catch (e) {
        send({ t: 'vad_error', id: m.id, message: (e as Error).message });
      }
      return;
    }
    chain = chain.then(async () => {
      try {
        send({ t: 'result', id: m.id, result: await transcribe(m), rss: rss() });
      } catch (e) {
        if (e instanceof SpanCancelledError) send({ t: 'cancelled', id: m.id, rss: rss() });
        else if (e instanceof VadFailedError)
          send({ t: 'error', id: m.id, message: e.detail, code: e.code, rss: rss() });
        else send({ t: 'error', id: m.id, message: (e as Error).message, rss: rss() });
      } finally {
        // Ids only grow, so this also drops a cancel that raced past its job's result.
        for (const id of cancelled) if (id <= m.id) cancelled.delete(id);
      }
    });
  });
  process.on('disconnect', () => process.exit(0));
}

if (import.meta.main) runSttChild(process.argv[2]);
