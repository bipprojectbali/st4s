/** A VAD failure crosses the STT child protocol as a typed error (`code: 'vad_failed'`), not a message match. */
import { describe, expect, test } from 'bun:test';
import { VAD_FAILED_MESSAGE, VadFailedError } from '../../server/engines/errors';
import { createSttEngine } from '../../server/engines/stt';
import type { SttChildEvents, SttSpawner } from '../../server/engines/stt/host';
import type { ToChild, TranscribeMsg } from '../../server/engines/stt/protocol';

const DETAIL = 'STT VAD failed on silero.bin (3.0s audio); check STT_VAD_MODEL';

function fakeSpawner() {
  const children: { on: SttChildEvents; sent: ToChild[] }[] = [];
  const spawn: SttSpawner = (_cfg, on) => {
    const c = { on, sent: [] as ToChild[] };
    children.push(c);
    queueMicrotask(() =>
      on.message({ t: 'ready', loadMs: 1, rss: 1000, backend: 'fake', gpu: false }),
    );
    return {
      send: (m) => c.sent.push(m),
      kill: () => queueMicrotask(() => on.exit(null, 'SIGTERM')),
    };
  };
  return { spawn, children };
}

async function failWith(code: 'vad_failed' | undefined) {
  const f = fakeSpawner();
  const eng = createSttEngine({
    spawn: f.spawn,
    config: { maxQueue: 4, idleTimeoutSec: 0, modelPath: '/m/qwen3-asr.gguf' },
  });
  const p = eng.transcribe({ audio: new Float32Array(16_000) }).catch((e: unknown) => e);
  await Bun.sleep(1);
  const c = f.children[0]!;
  const job = c.sent.find((m): m is TranscribeMsg => m.t === 'transcribe')!;
  c.on.message({ t: 'error', id: job.id, message: DETAIL, rss: 2000, ...(code ? { code } : {}) });
  return { err: await p, status: eng.status() };
}

describe('stt engine: VAD failure from the child', () => {
  test("code 'vad_failed' → VadFailedError with the generic message; detail only in lastError", async () => {
    const { err, status } = await failWith('vad_failed');
    expect(err).toBeInstanceOf(VadFailedError);
    const e = err as VadFailedError;
    expect(e.code).toBe('vad_failed');
    expect(e.message).toBe(VAD_FAILED_MESSAGE);
    expect(e.message).not.toContain('silero');
    expect(e.detail).toContain(DETAIL);
    expect(status.lastError).toContain(DETAIL);
    expect(status.state).toBe('ready');
  });

  test('an error without a code stays a plain Error (other failures keep their mapping)', async () => {
    const { err } = await failWith(undefined);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(VadFailedError);
    expect((err as Error).message).toBe(`STT transcription failed: ${DETAIL}`);
  });
});
