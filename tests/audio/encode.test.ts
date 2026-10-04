import { describe, expect, test } from 'bun:test';
import { encodeNative, floatToS16le, PCM_RATE, resampleLinear, wavHeader } from '../../server/audio/encode';
import { encodeFfmpeg, ffmpegAvailable } from '../../server/audio/encode-ffmpeg';

async function collect(it: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const c of it) parts.push(c);
  return new Uint8Array(Buffer.concat(parts));
}

async function* clips(...xs: Float32Array[]) {
  for (const x of xs) yield x;
}

describe('floatToS16le', () => {
  test('maps and clips [-1, 1] to int16 little-endian', () => {
    const b = floatToS16le(new Float32Array([0, 1, -1, 2, -2]));
    const v = new DataView(b.buffer);
    expect([0, 1, 2, 3, 4].map((i) => v.getInt16(i * 2, true))).toEqual([0, 32767, -32768, 32767, -32768]);
  });
});

describe('resampleLinear', () => {
  test('changes length by the rate ratio and is identity at equal rates', () => {
    const x = new Float32Array(44_100).fill(0.5);
    const y = resampleLinear(x, 44_100, PCM_RATE);
    expect(y.length).toBe(PCM_RATE);
    expect(y[100]).toBeCloseTo(0.5);
    expect(resampleLinear(x, 24_000, 24_000)).toBe(x);
  });
});

describe('wavHeader', () => {
  test('exact and streaming (0xFFFFFFFF) variants', () => {
    const exact = new DataView(wavHeader(24_000, 1000).buffer);
    expect(exact.getUint32(4, true)).toBe(1036);
    expect(exact.getUint32(24, true)).toBe(24_000);
    expect(exact.getUint32(40, true)).toBe(1000);
    const live = new DataView(wavHeader(44_100, null).buffer);
    expect(live.getUint32(4, true)).toBe(0xffffffff);
    expect(live.getUint32(40, true)).toBe(0xffffffff);
  });
});

describe('encodeNative', () => {
  test('wav = header + 2 bytes/sample; pcm resampled to 24 kHz', async () => {
    const a = new Float32Array(480);
    const wav = await collect(encodeNative('wav', 48_000, clips(a, a)));
    expect(wav.length).toBe(44 + 2 * 960);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF');
    const pcm = await collect(encodeNative('pcm', 48_000, clips(a, a)));
    expect(pcm.length).toBe(2 * 480);
  });
});

describe.skipIf(!ffmpegAvailable('ffmpeg'))('encodeFfmpeg', () => {
  const tone = new Float32Array(24_000).map((_, i) => 0.3 * Math.sin((2 * Math.PI * 440 * i) / 24_000));
  async function* pcm16() {
    yield floatToS16le(tone.subarray(0, 12_000));
    yield floatToS16le(tone.subarray(12_000));
  }

  test('mp3 starts with ID3 or an MPEG frame sync', async () => {
    const out = await collect(
      encodeFfmpeg({ bin: 'ffmpeg', format: 'mp3', sampleRate: 24_000, pcm16: pcm16(), signal: new AbortController().signal, timeoutMs: 30_000 }),
    );
    const id3 = new TextDecoder().decode(out.slice(0, 3)) === 'ID3';
    expect(id3 || (out[0] === 0xff && (out[1] & 0xe0) === 0xe0)).toBe(true);
  });

  test('opus is an Ogg stream, flac has fLaC magic', async () => {
    for (const [format, magic] of [['opus', 'OggS'], ['flac', 'fLaC']] as const) {
      const out = await collect(
        encodeFfmpeg({ bin: 'ffmpeg', format, sampleRate: 24_000, pcm16: pcm16(), signal: new AbortController().signal, timeoutMs: 30_000 }),
      );
      expect(new TextDecoder().decode(out.slice(0, 4))).toBe(magic);
    }
  });

  test('abort kills ffmpeg and ends the stream', async () => {
    const ctrl = new AbortController();
    async function* slow() {
      yield floatToS16le(tone);
      await Bun.sleep(3_000);
      yield floatToS16le(tone);
    }
    setTimeout(() => ctrl.abort(), 100);
    const t0 = performance.now();
    await collect(encodeFfmpeg({ bin: 'ffmpeg', format: 'mp3', sampleRate: 24_000, pcm16: slow(), signal: ctrl.signal, timeoutMs: 30_000 })).catch(() => null);
    expect(performance.now() - t0).toBeLessThan(2_000);
  }, 10_000);
});
