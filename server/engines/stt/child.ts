/** STT child process: owns libcrispasr (sync FFI, may crash) so the server event loop never blocks on decode. */
import type { Pointer } from 'bun:ffi';
import type { SttConfig } from './config';
import { openCrispasr } from './ffi';
import type { FromChild, ToChild, TranscribeMsg } from './protocol';
import { planSpans, runSpans, SpanCancelledError, SR } from './spans';

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
  let warnedNoVad = false;

  async function transcribe(m: TranscribeMsg) {
    const { lib, s } = eng;
    const audio =
      m.audio instanceof Float32Array ? m.audio : new Float32Array(m.audio as ArrayLike<number>);
    const lang =
      m.language === 'auto'
        ? cfg.lidModelPath
          ? lib.detectLanguage(cfg.lidModelPath, audio, cfg.threads)
          : null
        : m.language;
    lib.setHotwords(s, m.hotwords);
    // qwen3 fires token callbacks only after a span's full decode (crispasr_c_api.cpp _fire_token_callbacks),
    // so streaming = one delta per span (VAD speech merged up to STT_MAX_CHUNK_SEC), emitted between FFI calls.
    const vad = cfg.vadModelPath
      ? lib.vadSlices(cfg.vadModelPath, audio, cfg.maxChunkSec, cfg.threads)
      : null;
    if (!vad?.length && !warnedNoVad) {
      warnedNoVad = true;
      warn(
        `VAD ${cfg.vadModelPath ? 'returned no slices' : 'disabled'}; falling back to fixed ${cfg.maxChunkSec}s slices`,
      );
    }
    const duration = audio.length / SR;
    const { text, segments } = await runSpans({
      id: m.id,
      audio,
      plan: planSpans(duration, vad, cfg.maxChunkSec),
      decode: (pcm, offset) => lib.transcribe(s, pcm, lang, m.words, offset),
      onDelta: (delta) => send({ t: 'delta', id: m.id, text: delta }),
      isCancelled: () => cancelled.has(m.id),
      yieldNow: flush,
    });
    return { text, language: lang ?? 'unknown', duration, segments };
  }

  let chain = Promise.resolve();
  process.on('message', (m: ToChild) => {
    if (m.t === 'cancel') {
      cancelled.add(m.id);
      return;
    }
    chain = chain.then(async () => {
      try {
        send({ t: 'result', id: m.id, result: await transcribe(m), rss: rss() });
      } catch (e) {
        if (e instanceof SpanCancelledError) send({ t: 'cancelled', id: m.id, rss: rss() });
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
