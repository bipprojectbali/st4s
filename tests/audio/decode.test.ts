import { afterEach, describe, expect, it } from 'bun:test';
import { findFfmpeg } from '../../server/audio/decode-ffmpeg';
import { AudioDecodeError, decodeTo16kMono, resampleLinear } from '../../server/audio/decode';
import { makeWav } from '../v1/wav-fixture';

const ORIGINAL_FFMPEG = process.env.V1_FFMPEG_PATH;
afterEach(() => {
  if (ORIGINAL_FFMPEG === undefined) delete process.env.V1_FFMPEG_PATH;
  else process.env.V1_FFMPEG_PATH = ORIGINAL_FFMPEG;
});
const noFfmpeg = () => {
  process.env.V1_FFMPEG_PATH = '/nonexistent/ffmpeg-for-test';
};
const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);

describe('decodeTo16kMono — WAV (native)', () => {
  it('44.1 kHz stereo 16-bit -> 16 kHz mono with the right length and duration', async () => {
    noFfmpeg();
    const wav = makeWav({ sampleRate: 44_100, channels: 2, bits: 16, frames: 44_100 * 2 });
    const { audio, durationSec } = await decodeTo16kMono(wav, { filename: 'a.wav' });
    expect(durationSec).toBeCloseTo(2, 6);
    expect(audio.length).toBe(32_000);
    expect(rms(audio)).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });

  it('48 kHz mono float32 -> 16 kHz with the right length and duration', async () => {
    noFfmpeg();
    const wav = makeWav({ sampleRate: 48_000, channels: 1, bits: 32, float: true, frames: 72_000 });
    const { audio, durationSec } = await decodeTo16kMono(wav);
    expect(durationSec).toBeCloseTo(1.5, 6);
    expect(audio.length).toBe(24_000);
    expect(Math.max(...audio)).toBeLessThanOrEqual(0.5001);
  });

  it('averages channels into mono', async () => {
    const wav = makeWav({ sampleRate: 16_000, channels: 2, bits: 16, frames: 100, value: (_i, c) => (c ? 0.5 : -0.25) });
    const { audio } = await decodeTo16kMono(wav);
    expect(audio.length).toBe(100);
    expect(audio[50]).toBeCloseTo(0.125, 3);
  });

  it('reads 8-bit, 24-bit and 32-bit PCM', async () => {
    for (const bits of [8, 24, 32] as const) {
      const wav = makeWav({ sampleRate: 8_000, channels: 1, bits, frames: 8_000, value: () => 0.5 });
      const { audio, durationSec } = await decodeTo16kMono(wav);
      expect(durationSec).toBeCloseTo(1, 6);
      expect(audio.length).toBe(16_000);
      expect(audio[1000]).toBeCloseTo(0.5, bits === 8 ? 1 : 4);
    }
  });

  it('rejects a corrupt WAV as invalid_audio when ffmpeg is absent', async () => {
    noFfmpeg();
    const wav = makeWav({ sampleRate: 16_000, channels: 1, bits: 16, frames: 10 });
    const broken = wav.slice(0, 36); // header without a data chunk
    const err = await decodeTo16kMono(broken).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AudioDecodeError);
    expect((err as AudioDecodeError).code).toBe('invalid_audio');
  });
});

describe('decodeTo16kMono — other formats', () => {
  it('without ffmpeg, non-WAV input is unsupported_format', async () => {
    noFfmpeg();
    const mp3ish = new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4]);
    const err = await decodeTo16kMono(mp3ish, { filename: 'clip.mp3' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AudioDecodeError);
    expect((err as AudioDecodeError).code).toBe('unsupported_format');
    expect((err as Error).message).toContain('clip.mp3');
  });

  it.skipIf(!findFfmpeg())('with ffmpeg, garbage input is invalid_audio', async () => {
    const err = await decodeTo16kMono(new Uint8Array(64).fill(7), { filename: 'x.ogg' }).catch((e: unknown) => e);
    expect((err as AudioDecodeError).code).toBe('invalid_audio');
  });

  it.skipIf(!findFfmpeg())('with ffmpeg, a WAV routed through ffmpeg decodes to 16 kHz', async () => {
    const bin = findFfmpeg() as string;
    const { ffmpegTo16kMono } = await import('../../server/audio/decode-ffmpeg');
    const wav = makeWav({ sampleRate: 22_050, channels: 2, bits: 16, frames: 22_050 });
    const audio = await ffmpegTo16kMono(bin, wav);
    expect(Math.abs(audio.length - 16_000)).toBeLessThan(200);
  });
});

describe('resampleLinear', () => {
  it('keeps 16 kHz input as-is and interpolates otherwise', () => {
    const same = new Float32Array([0, 1]);
    expect(resampleLinear(same, 16_000)).toBe(same);
    const up = resampleLinear(new Float32Array([0, 1, 0, 1]), 8_000);
    expect(up.length).toBe(8);
    expect(up[1]).toBeCloseTo(0.5, 6);
  });
});
