// TTS child process: owns the ONNX sessions so inference never blocks (or crashes) the server.
import type { ChildMsg, ParentMsg } from './protocol';
import type { Supertonic } from './supertonic';

const rss = () => process.memoryUsage().rss;

function reply(msg: ChildMsg): void {
  if (!process.send) throw new Error('TTS child started without an IPC channel');
  process.send(msg);
}

// `bun build --compile` embeds onnxruntime_binding.node but not its @rpath dependency libonnxruntime.1.dylib/.so.
const binaryHint = (message: string) =>
  Bun.isStandaloneExecutable && /libonnxruntime/.test(message)
    ? ' — the compiled binary cannot find libonnxruntime: set DYLD_LIBRARY_PATH (macOS) / LD_LIBRARY_PATH (Linux) to node_modules/onnxruntime-node/bin/napi-v6/<os>/<arch>, or run from source (`bun run start`)'
    : '';

/** Run the TTS child loop: load on demand, then serve synth requests one at a time. */
export function runTtsChild(): void {
  let tts: Supertonic | null = null;
  let queue = Promise.resolve();

  async function handle(msg: ParentMsg): Promise<void> {
    if (msg.type === 'load') {
      const t0 = performance.now();
      try {
        // Lazy so the binary can start this child (and report the error) even when onnxruntime-node is missing.
        const { Supertonic } = await import('./supertonic');
        tts = await Supertonic.load(msg.modelDir, msg.threads);
        reply({
          type: 'loaded',
          sampleRate: tts.sampleRate,
          loadMs: performance.now() - t0,
          rss: rss(),
        });
      } catch (e) {
        const reason = (e as Error).message;
        reply({
          type: 'error',
          message: `TTS model load failed (${msg.modelDir}): ${reason}${binaryHint(reason)}`,
          rss: rss(),
        });
      }
      return;
    }
    try {
      if (!tts) throw new Error('TTS model is not loaded');
      const pcm = await tts.synthesize(msg.text, msg.language, msg.voice, msg.steps, msg.speed);
      reply({ type: 'result', id: msg.id, pcm, rss: rss() });
    } catch (e) {
      reply({
        type: 'error',
        id: msg.id,
        message: `TTS synthesis failed: ${(e as Error).message}`,
        rss: rss(),
      });
    }
  }

  process.on('message', (msg: ParentMsg) => {
    queue = queue.then(() => handle(msg));
  });
  process.on('disconnect', () => process.exit(0));
}

if (import.meta.main) runTtsChild();
