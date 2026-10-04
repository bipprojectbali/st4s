/** Realtime client audio: PCM16 clamping/round-trip, streaming resampler, sliced base64. */
import { describe, expect, test } from 'bun:test';
import { base64ToBytes, s16leToFloat } from '../app/lib/pcm-player';
import { bytesToBase64, createResampler, floatToPcm16 } from '../app/lib/realtime-audio';

const int16 = (bytes: Uint8Array) =>
  Array.from({ length: bytes.length / 2 }, (_, i) =>
    new DataView(bytes.buffer, bytes.byteOffset).getInt16(i * 2, true),
  );

describe('floatToPcm16', () => {
  test('little-endian, full scale both ways, clamps out-of-range and NaN', () => {
    const bytes = floatToPcm16(new Float32Array([0, 1, -1, 2, -3, Number.NaN, 0.5]));
    expect(bytes.length).toBe(14);
    expect(int16(bytes)).toEqual([0, 32767, -32768, 32767, -32768, 0, 16383]);
    expect([bytes[2], bytes[3]]).toEqual([0xff, 0x7f]);
  });

  // Encoder scales positives by 0x7fff, decoder divides by 0x8000: worst case ~2 LSB apart.
  test('round-trips through the playback decoder within two LSB', () => {
    const src = new Float32Array(200).map((_, i) => Math.sin(i / 7) * 0.9);
    const { samples, rest } = s16leToFloat(floatToPcm16(src));
    expect(rest.length).toBe(0);
    expect(samples.length).toBe(src.length);
    for (let i = 0; i < src.length; i++)
      expect(Math.abs(samples[i] - src[i])).toBeLessThan(2 / 32768);
  });
});

describe('createResampler', () => {
  test('48k → 24k halves the length and averages each pair', () => {
    const r = createResampler(48_000, 24_000);
    const input = new Float32Array(4800).map((_, i) => i % 4);
    const out = r(input);
    expect(out.length).toBe(2400);
    expect(Array.from(out.slice(0, 4))).toEqual([0.5, 2.5, 0.5, 2.5]);
  });

  test('chunked stream equals one-shot output (state carries across chunks)', () => {
    const input = new Float32Array(4410).map((_, i) => Math.sin(i / 11));
    const whole = createResampler(44_100, 24_000)(input);
    const r = createResampler(44_100, 24_000);
    const parts = [r(input.slice(0, 1000)), r(input.slice(1000, 1001)), r(input.slice(1001))];
    const joined = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
      joined.set(p, o);
      o += p.length;
    }
    expect(joined.length).toBe(whole.length);
    expect(Math.abs(whole.length - 2400)).toBeLessThanOrEqual(1);
    for (let i = 0; i < whole.length; i++) expect(joined[i]).toBeCloseTo(whole[i], 6);
  });

  test('constant signal stays constant; same rate is identity; 16k → 24k upsamples', () => {
    const flat = createResampler(48_000, 24_000)(new Float32Array(960).fill(0.25));
    expect(flat.every((v) => v === 0.25)).toBe(true);
    const same = createResampler(24_000, 24_000)(new Float32Array([0.1, 0.2, 0.3]));
    expect(Array.from(same)).toEqual(Array.from(new Float32Array([0.1, 0.2, 0.3])));
    const up = createResampler(16_000, 24_000)(new Float32Array([0, 1, 2, 3]));
    expect(Array.from(up).map((v) => +v.toFixed(4))).toEqual([0, 0.6667, 1.3333, 2, 2.6667]);
  });
});

describe('bytesToBase64', () => {
  test('matches Buffer encoding across the slice boundary and round-trips', () => {
    const bytes = new Uint8Array(0x8000 * 2 + 123).map((_, i) => (i * 31) & 0xff);
    const b64 = bytesToBase64(bytes);
    expect(b64).toBe(Buffer.from(bytes).toString('base64'));
    expect(base64ToBytes(b64)).toEqual(bytes);
    expect(bytesToBase64(new Uint8Array(0))).toBe('');
  });
});
