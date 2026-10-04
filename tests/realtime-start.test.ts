/** Cancelable start stages: abort/timeout end the wait and late values are released, not leaked. */
import { describe, expect, test } from 'bun:test';
import {
  abortable,
  isAbortError,
  openSocket,
  SOCKET_TIMEOUT_MESSAGE,
  SocketClosedError,
} from '../app/lib/realtime-start';
import { initialRealtimeState, realtimeReducer } from '../app/lib/realtime-state';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('abortable', () => {
  test('resolves with the value when nothing interrupts', async () => {
    const released: number[] = [];
    const p = abortable(Promise.resolve(7), new AbortController().signal, {
      release: (v) => released.push(v),
      timeoutMs: 1000,
    });
    expect(await p).toBe(7);
    expect(released).toEqual([]);
  });

  test('abort rejects immediately; a value resolving afterwards is released', async () => {
    const d = deferred<string>();
    const ac = new AbortController();
    const released: string[] = [];
    const p = abortable(d.promise, ac.signal, { release: (v) => released.push(v) });
    ac.abort();
    const err = await p.catch((e: unknown) => e);
    expect(isAbortError(err)).toBe(true);
    d.resolve('stream');
    await Bun.sleep(0);
    expect(released).toEqual(['stream']);
  });

  test('already-aborted signal rejects without waiting', async () => {
    const ac = new AbortController();
    ac.abort();
    const err = await abortable(new Promise<never>(() => {}), ac.signal).catch((e: unknown) => e);
    expect(isAbortError(err)).toBe(true);
  });

  test('timeout rejects with the given message and releases a late value', async () => {
    const d = deferred<number>();
    const released: number[] = [];
    const err = await abortable(d.promise, new AbortController().signal, {
      release: (v) => released.push(v),
      timeoutMs: 5,
      timeoutMessage: 'terlalu lama',
    }).catch((e: Error) => e);
    expect((err as Error).message).toBe('terlalu lama');
    expect(isAbortError(err)).toBe(false);
    d.resolve(1);
    await Bun.sleep(0);
    expect(released).toEqual([1]);
  });

  test('a late rejection after abort is swallowed by the settled wait, not unhandled', async () => {
    const d = deferred<number>();
    const ac = new AbortController();
    const p = abortable(d.promise, ac.signal);
    ac.abort();
    await p.catch(() => {});
    d.reject(new Error('late'));
    await Bun.sleep(0);
    expect(ac.signal.aborted).toBe(true);
  });
});

class FakeSocket {
  readyState: WebSocket['readyState'] = WebSocket.CONNECTING;
  onopen: WebSocket['onopen'] = null;
  onclose: WebSocket['onclose'] = null;
  closed: Array<[number | undefined, string | undefined]> = [];
  close(code?: number, reason?: string) {
    this.closed.push([code, reason]);
    this.readyState = WebSocket.CLOSED;
  }
  open() {
    this.readyState = WebSocket.OPEN;
    this.onopen?.call(this as unknown as WebSocket, new Event('open'));
  }
  serverClose(code: number, reason: string) {
    this.readyState = WebSocket.CLOSED;
    this.onclose?.call(this as unknown as WebSocket, { code, reason } as CloseEvent);
  }
}

describe('openSocket', () => {
  test('resolves once open and clears its own handlers', async () => {
    const ws = new FakeSocket();
    const p = openSocket(() => ws, new AbortController().signal, 1000);
    ws.open();
    expect(await p).toBe(ws);
    expect(ws.onopen).toBeNull();
    expect(ws.onclose).toBeNull();
    expect(ws.closed).toEqual([]);
  });

  test('abort while connecting closes the socket and rejects as abort', async () => {
    const ws = new FakeSocket();
    const ac = new AbortController();
    const p = openSocket(() => ws, ac.signal, 1000);
    ac.abort();
    expect(isAbortError(await p.catch((e: unknown) => e))).toBe(true);
    expect(ws.closed).toEqual([[1000, 'client stop']]);
    ws.open(); // a late open must not resurrect anything
    expect(ws.onopen).toBeNull();
  });

  test('aborted before start never creates a socket', async () => {
    const ac = new AbortController();
    ac.abort();
    let created = 0;
    const err = await openSocket(() => {
      created++;
      return new FakeSocket();
    }, ac.signal).catch((e: unknown) => e);
    expect(isAbortError(err)).toBe(true);
    expect(created).toBe(0);
  });

  test('timeout closes the socket with an actionable message', async () => {
    const ws = new FakeSocket();
    const err = await openSocket(() => ws, new AbortController().signal, 5).catch((e: Error) => e);
    expect((err as Error).message).toBe(SOCKET_TIMEOUT_MESSAGE);
    expect(ws.closed).toEqual([[1000, 'client stop']]);
  });

  test('server close before open rejects with its code and reason', async () => {
    const ws = new FakeSocket();
    const p = openSocket(() => ws, new AbortController().signal, 1000);
    ws.serverClose(1006, '');
    const err = await p.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SocketClosedError);
    expect((err as SocketClosedError).code).toBe(1006);
    expect(ws.closed).toEqual([]);
  });
});

describe('stop when idle', () => {
  test('local.closed on an idle state keeps it idle', () => {
    expect(realtimeReducer(initialRealtimeState, { type: 'local.closed', lost: false })).toEqual(
      initialRealtimeState,
    );
  });
});
