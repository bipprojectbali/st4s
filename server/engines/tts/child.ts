// TTS child process: owns the ONNX sessions so inference never blocks (or crashes) the server.
import type { ChildMsg, ParentMsg } from './protocol';
import { Supertonic } from './supertonic';

let tts: Supertonic | null = null;
let queue = Promise.resolve();

function reply(msg: ChildMsg): void {
  process.send!(msg);
}

const rss = () => process.memoryUsage().rss;

async function handle(msg: ParentMsg): Promise<void> {
  if (msg.type === 'load') {
    const t0 = performance.now();
    try {
      tts = await Supertonic.load(msg.modelDir, msg.threads);
      reply({ type: 'loaded', sampleRate: tts.sampleRate, loadMs: performance.now() - t0, rss: rss() });
    } catch (e) {
      reply({ type: 'error', message: `TTS model load failed (${msg.modelDir}): ${(e as Error).message}`, rss: rss() });
    }
    return;
  }
  try {
    if (!tts) throw new Error('TTS model is not loaded');
    const pcm = await tts.synthesize(msg.text, msg.language, msg.voice, msg.steps, msg.speed);
    reply({ type: 'result', id: msg.id, pcm, rss: rss() });
  } catch (e) {
    reply({ type: 'error', id: msg.id, message: `TTS synthesis failed: ${(e as Error).message}`, rss: rss() });
  }
}

process.on('message', (msg: ParentMsg) => {
  queue = queue.then(() => handle(msg));
});
process.on('disconnect', () => process.exit(0));
