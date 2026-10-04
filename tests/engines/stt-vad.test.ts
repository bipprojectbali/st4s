import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSttConfig } from '../../server/engines/stt/config';
import { openCrispasr } from '../../server/engines/stt/ffi';
import type { ToChild } from '../../server/engines/stt/protocol';
import { createVadBridge } from '../../server/engines/stt/vad';

const opts = { threshold: 0.5, minSilenceMs: 100 };

describe('createVadBridge', () => {
  function bridge(sendOk = true) {
    const sent: ToChild[] = [];
    const b = createVadBridge({
      ensure: async () => {},
      send: (m) => {
        sent.push(m);
        return sendOk;
      },
    });
    return { b, sent };
  }

  test('vad_result resolves with the spans', async () => {
    const { b, sent } = bridge();
    const p = b.vad(new Float32Array(160), opts);
    await Bun.sleep(0);
    b.onMessage({ t: 'vad_result', id: (sent[0] as { id: number }).id, spans: [[0.1, 0.4]] });
    expect(await p).toEqual([[0.1, 0.4]]);
  });

  test('vad_error rejects, so a VAD that could not run never reads as "no speech"', async () => {
    const { b, sent } = bridge();
    const p = b.vad(new Float32Array(160), opts);
    await Bun.sleep(0);
    b.onMessage({ t: 'vad_error', id: (sent[0] as { id: number }).id, message: 'rc=-3' });
    await expect(p).rejects.toThrow('STT VAD failed: rc=-3');
  });

  test('no live child rejects instead of hanging', async () => {
    const { b } = bridge(false);
    await expect(b.vad(new Float32Array(160), opts)).rejects.toThrow('STT child gone');
  });
});

// Needs the patched libcrispasr (scripts/crispasr/build.sh) in CRISPASR_LIB; loads only the Silero VAD (~1 MB), no ASR model.
describe.skipIf(process.env.ST4S_REAL_ENGINE !== '1')('vadSlices on the real libcrispasr', () => {
  const cfg = loadSttConfig();
  const junk = path.join(os.tmpdir(), `st4s-junk-vad-${process.pid}.bin`);
  let lib: ReturnType<typeof openCrispasr>;
  beforeAll(() => {
    lib = openCrispasr(cfg.libPath);
    writeFileSync(junk, Buffer.alloc(4096, 0x5a)); // test-only
  });
  afterAll(() => {
    rmSync(junk, { force: true });
    lib.close();
  });

  test('3 s of silence → [] (VAD ran, no speech)', () => {
    expect(lib.vadSlices(cfg.vadModelPath, new Float32Array(16_000 * 3), 30, 1)).toEqual([]);
  });

  test('a corrupt VAD model → null (could not run), not []', () => {
    expect(lib.vadSlices(junk, new Float32Array(16_000 * 3), 30, 1)).toBeNull();
  });

  test('a missing VAD model → null', () => {
    expect(lib.vadSlices(`${junk}.missing`, new Float32Array(16_000), 30, 1)).toBeNull();
  });
});
