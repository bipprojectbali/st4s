/** Manual commit: the worklet's buffered tail is appended before input_audio_buffer.commit. */
import { describe, expect, test } from 'bun:test';
import { createMicPort, flushThenCommit } from '../app/lib/realtime-mic';

// Mirrors the inline worklet: async port, partial frame (if any) then the flushed marker.
function fakeMic(buffered: number, sent: string[]) {
  let n = buffered;
  const port = createMicPort(
    (frame) => sent.push(`append:${frame.length}`),
    () =>
      queueMicrotask(() => {
        if (n > 0) port.receive(new Float32Array(n));
        n = 0;
        port.receive({ type: 'flushed' });
      }),
  );
  return port;
}

const socket = (sent: string[], readyState: WebSocket['readyState'] = WebSocket.OPEN) => ({
  readyState,
  send: (m: string) => void sent.push(m),
});

describe('flushThenCommit', () => {
  test('flushed remainder is appended before the commit', async () => {
    const sent: string[] = [];
    expect(await flushThenCommit(fakeMic(1234, sent), socket(sent), 'commit')).toBe(true);
    expect(sent).toEqual(['append:1234', 'commit']);
  });

  test('empty buffer → commit only', async () => {
    const sent: string[] = [];
    expect(await flushThenCommit(fakeMic(0, sent), socket(sent), 'commit')).toBe(true);
    expect(sent).toEqual(['commit']);
  });

  test('socket no longer open after flush → no commit', async () => {
    const sent: string[] = [];
    expect(await flushThenCommit(fakeMic(0, sent), socket(sent, WebSocket.CLOSING), 'c')).toBe(
      false,
    );
    expect(sent).toEqual([]);
  });
});

describe('createMicPort', () => {
  test('frames pass through; markers settle flushes in order', async () => {
    const frames: number[] = [];
    const posts: unknown[] = [];
    const port = createMicPort(
      (f) => frames.push(f.length),
      (m) => posts.push(m),
    );
    const order: string[] = [];
    const a = port.flush().then(() => order.push('a'));
    const b = port.flush().then(() => order.push('b'));
    expect(posts).toEqual([{ type: 'flush' }, { type: 'flush' }]);
    port.receive(new Float32Array(3));
    port.receive({ type: 'flushed' });
    await a;
    expect(order).toEqual(['a']);
    port.receive({ type: 'other' });
    port.receive({ type: 'flushed' });
    await b;
    expect(order).toEqual(['a', 'b']);
    expect(frames).toEqual([3]);
  });

  test('release settles a flush whose marker never arrives', async () => {
    const port = createMicPort(
      () => {},
      () => {},
    );
    const done = port.flush();
    port.release();
    await expect(done).resolves.toBeUndefined();
  });
});
