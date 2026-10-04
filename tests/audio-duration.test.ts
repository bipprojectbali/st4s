/** blobDuration: finite metadata wins; Infinity/NaN/0 and load errors resolve null; the object URL is always revoked. */
import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { blobDuration } from '../app/lib/audio-duration';

type Outcome = { duration: number } | 'error';
let next: Outcome = 'error';

/** Minimal HTMLAudioElement stand-in: fires the queued outcome once `src` is set. */
class FakeAudio {
  preload = '';
  duration = Number.NaN;
  onloadedmetadata: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_: string) {
    queueMicrotask(() => {
      if (next === 'error') return this.onerror?.();
      this.duration = next.duration;
      this.onloadedmetadata?.();
    });
  }
}

const g = globalThis as { Audio?: unknown };
const original = g.Audio;
let revoke: ReturnType<typeof spyOn>;
beforeAll(() => {
  g.Audio = FakeAudio;
});
afterAll(() => {
  g.Audio = original;
});
afterEach(() => revoke?.mockRestore());

const run = async (outcome: Outcome) => {
  next = outcome;
  revoke = spyOn(URL, 'revokeObjectURL');
  const s = await blobDuration(new Blob([new Uint8Array(4)], { type: 'audio/webm' }));
  expect(revoke).toHaveBeenCalledTimes(1);
  return s;
};

describe('blobDuration', () => {
  test('finite duration from metadata', async () => {
    expect(await run({ duration: 3.25 })).toBe(3.25);
  });

  test('webm recording reporting Infinity → null', async () => {
    expect(await run({ duration: Number.POSITIVE_INFINITY })).toBeNull();
  });

  test('NaN duration → null', async () => {
    expect(await run({ duration: Number.NaN })).toBeNull();
  });

  test('zero duration → null', async () => {
    expect(await run({ duration: 0 })).toBeNull();
  });

  test('undecodable blob → null', async () => {
    expect(await run('error')).toBeNull();
  });
});
