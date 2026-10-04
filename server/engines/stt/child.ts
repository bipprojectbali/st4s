/** STT child process: owns libcrispasr (sync FFI, may crash) so the server event loop never blocks on decode. */
import type { Pointer } from 'bun:ffi';
import type { SttConfig } from './config';
import { openCrispasr } from './ffi';
import type { FromChild, ToChild } from './protocol';
import type { TranscriptSegment } from '../types';

const SR = 16_000;
const MIN_SPAN = SR / 10;

/** Run the STT child loop; `cfgJson` is the serialized SttConfig the host passes on argv. */
export function runSttChild(cfgJson: string | undefined): void {
  const cfg = JSON.parse(cfgJson ?? '') as SttConfig;
  const send = (m: FromChild) => process.send!(m);
  const rss = () => process.memoryUsage().rss;

  function load() {
    const t0 = performance.now();
    const lib = openCrispasr(cfg.libPath);
    let gpu = true;
    let s: Pointer | null = lib.openSession(cfg.modelPath, cfg.threads, true);
    if (!s) {
      gpu = false;
      s = lib.openSession(cfg.modelPath, cfg.threads, false);
    }
    if (!s) throw new Error(`crispasr session open failed for ${cfg.modelPath} (GPU and CPU)`);
    return { lib, s, gpu, loadMs: performance.now() - t0 };
  }

  let eng: ReturnType<typeof load>;
  try {
    eng = load();
  } catch (e) {
    send({ t: 'load_error', message: `STT model load failed: ${(e as Error).message}` });
    process.exit(1);
  }
  send({ t: 'ready', loadMs: eng.loadMs, rss: rss(), backend: eng.lib.backend(eng.s), gpu: eng.gpu });

  // Yields so the queued IPC write leaves the process before the next blocking FFI call.
  const flush = () => new Promise<void>((r) => setImmediate(r));

  async function transcribe(m: ToChild) {
    const { lib, s } = eng;
    const audio = m.audio instanceof Float32Array ? m.audio : new Float32Array(m.audio as ArrayLike<number>);
    const lang = m.language === 'auto' ? (cfg.lidModelPath ? lib.detectLanguage(cfg.lidModelPath, audio, cfg.threads) : null) : m.language;
    lib.setHotwords(s, m.hotwords);
    // qwen3 fires token callbacks only after a span's full decode (crispasr_c_api.cpp _fire_token_callbacks),
    // so streaming = one delta per VAD chunk (speech merged up to STT_MAX_CHUNK_SEC), emitted between FFI calls.
    const spans = cfg.vadModelPath ? lib.vadSlices(cfg.vadModelPath, audio, cfg.maxChunkSec, cfg.threads) : null;
    const plan = spans?.length ? spans : [[0, audio.length / SR] as [number, number]];
    const segments: TranscriptSegment[] = [];
    let text = '';
    for (const [a, b] of plan) {
      const sub = audio.subarray(Math.floor(a * SR), Math.min(audio.length, Math.ceil(b * SR)));
      if (sub.length < MIN_SPAN) continue;
      const segs = lib.transcribe(s, sub, lang, m.words, a);
      if (!segs) throw new Error(`crispasr transcribe failed on span ${a.toFixed(2)}-${b.toFixed(2)}s`);
      for (const seg of segs) if (seg.text) segments.push({ ...seg, id: segments.length });
      const piece = segs.map((x) => x.text).filter(Boolean).join(' ');
      if (!piece) continue;
      const delta = text ? ` ${piece}` : piece;
      text += delta;
      send({ t: 'delta', id: m.id, text: delta });
      await flush();
    }
    return { text, language: lang ?? 'unknown', duration: audio.length / SR, segments };
  }

  let chain = Promise.resolve();
  process.on('message', (m: ToChild) => {
    chain = chain.then(async () => {
      try {
        send({ t: 'result', id: m.id, result: await transcribe(m), rss: rss() });
      } catch (e) {
        send({ t: 'error', id: m.id, message: (e as Error).message, rss: rss() });
      }
    });
  });
  process.on('disconnect', () => process.exit(0));
}

if (import.meta.main) runSttChild(process.argv[2]);
