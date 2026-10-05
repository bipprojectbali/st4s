import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { MODEL_SPECS, modelManifest, selectGroup } from '../../server/models/manifest';

describe('model manifest', () => {
  it('pins 19 files totalling the documented 1,970,768,755 bytes', () => {
    expect(MODEL_SPECS).toHaveLength(19);
    expect(MODEL_SPECS.reduce((n, s) => n + s.size, 0)).toBe(1970768755);
    expect(new Set(MODEL_SPECS.map((s) => s.dest)).size).toBe(19);
    expect(new Set(MODEL_SPECS.map((s) => s.id)).size).toBe(19);
    for (const s of MODEL_SPECS) {
      expect(s.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(s.rev).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it('uses the agreed layout under the models dir', () => {
    const dests = MODEL_SPECS.map((s) => s.dest);
    expect(dests).toContain('stt/qwen3-asr-1.7b-q4_k.gguf');
    expect(dests).toContain('stt/ggml-silero-v6.2.0.bin');
    expect(dests).toContain('stt/ggml-tiny.bin');
    expect(dests).toContain('tts/onnx/vocoder.onnx');
    expect(dests.filter((d) => d.startsWith('tts/voice_styles/'))).toHaveLength(10);
    expect(selectGroup(modelManifest(), 'stt')).toHaveLength(3);
    expect(selectGroup(modelManifest(), 'tts')).toHaveLength(16);
  });

  it('builds pinned HF resolve URLs and honours ST4S_MODELS_BASE_URL', () => {
    const [qwen] = modelManifest(MODEL_SPECS, {});
    expect(qwen.url).toBe(
      'https://huggingface.co/cstr/qwen3-asr-1.7b-GGUF/resolve/674df5d44b50a63e7102a18895ed20e3f91de301/qwen3-asr-1.7b-q4_k.gguf',
    );
    const [mirrored] = modelManifest(MODEL_SPECS, {
      ST4S_MODELS_BASE_URL: 'http://mirror.lan/hf/',
    });
    expect(mirrored.url.startsWith('http://mirror.lan/hf/cstr/qwen3-asr-1.7b-GGUF/resolve/')).toBe(
      true,
    );
  });

  it('vendors the exact Supertonic OpenRAIL-M LICENSE (15007 B)', async () => {
    const file = Bun.file(
      path.join(import.meta.dir, '../../server/models/licenses/supertonic-3-OpenRAIL-M.txt'),
    );
    expect(file.size).toBe(15007);
    expect((await file.text()).startsWith('BigScience Open RAIL-M License')).toBe(true);
  });
});
