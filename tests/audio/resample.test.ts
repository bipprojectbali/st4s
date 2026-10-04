import { describe, expect, it } from 'bun:test';
import { createResampler24to16, pcm16ToFloat } from '../../server/audio/resample';

const tone = (hz: number, sec: number, sr = 24_000) =>
  Float32Array.from(
    { length: Math.round(sec * sr) },
    (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / sr),
  );

const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);

describe('createResampler24to16', () => {
  it('keeps 2/3 of the samples and passes a 1 kHz tone at the right frequency', () => {
    const out = createResampler24to16().push(tone(1_000, 1));
    expect(Math.abs(out.length - 16_000)).toBeLessThanOrEqual(16);
    const body = out.subarray(200, 15_000);
    expect(rms(body)).toBeCloseTo(0.5 / Math.SQRT2, 2);
    // Correlate with the ideal 16 kHz tone: phase-aligned, so error stays tiny.
    let err = 0;
    for (let i = 200; i < 15_000; i++)
      err = Math.max(err, Math.abs(out[i] - 0.5 * Math.sin((2 * Math.PI * 1_000 * i) / 16_000)));
    expect(err).toBeLessThan(0.01);
  });

  it('attenuates content above the 8 kHz output Nyquist instead of aliasing it', () => {
    const out = createResampler24to16().push(tone(10_000, 1));
    expect(rms(out.subarray(200, 15_000))).toBeLessThan(0.01);
  });

  it('gives the same output whatever the chunking', () => {
    const input = tone(440, 0.5);
    const whole = createResampler24to16().push(input);
    const r = createResampler24to16();
    const parts: number[] = [];
    for (let i = 0; i < input.length; i += 2_399)
      parts.push(...r.push(input.subarray(i, i + 2_399)));
    expect(parts.length).toBe(whole.length);
    for (let i = 0; i < whole.length; i++) expect(Math.abs(parts[i] - whole[i])).toBeLessThan(1e-6);
  });
});

describe('pcm16ToFloat', () => {
  it('decodes little-endian samples to [-1, 1)', () => {
    const f = pcm16ToFloat(new Uint8Array([0x00, 0x80, 0xff, 0x7f, 0x00, 0x00]));
    expect(Array.from(f)).toEqual([-1, 32767 / 32768, 0]);
  });

  it('reads from an unaligned view', () => {
    const bytes = new Uint8Array([9, 0x00, 0x40]).subarray(1);
    expect(pcm16ToFloat(bytes)[0]).toBe(0.5);
  });

  it('rejects an odd byte count', () => {
    expect(() => pcm16ToFloat(new Uint8Array(3))).toThrow('even byte count');
  });
});
