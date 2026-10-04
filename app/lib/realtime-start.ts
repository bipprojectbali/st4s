/** Cancelable start-sequence primitives for the realtime panel: abort/timeout-bounded awaits. */

/** Upper bound for a start stage that depends on a browser API or server that may never settle. */
export const START_STAGE_TIMEOUT_MS = 10_000;

export const WORKLET_TIMEOUT_MESSAGE =
  'Browser tidak dapat memulai perekam audio. Coba browser lain atau muat ulang.';
export const SOCKET_TIMEOUT_MESSAGE =
  'Server realtime tidak merespons. Periksa koneksi atau cek /dev/engines, lalu coba lagi.';

/** Thrown when the user stopped the session mid-start; callers return to idle silently. */
export class StartAbortedError extends Error {
  constructor() {
    super('Realtime start aborted');
    this.name = 'AbortError';
  }
}

/** True for an abort raised by this module or by the platform (`DOMException` AbortError). */
export const isAbortError = (e: unknown) => e instanceof Error && e.name === 'AbortError';

type Bound<T> = {
  /** Called with the value if `p` resolves after the caller stopped waiting (abort or timeout). */
  release?: (value: T) => void;
  timeoutMs?: number;
  timeoutMessage?: string;
};

/**
 * Awaits `p` but rejects as soon as `signal` aborts (StartAbortedError) or `timeoutMs` passes
 * (Error with `timeoutMessage`). A value that arrives late is handed to `release` so it never leaks.
 */
export function abortable<T>(p: Promise<T>, signal: AbortSignal, o: Bound<T> = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      fn();
    };
    const onAbort = () => finish(() => reject(new StartAbortedError()));
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    if (o.timeoutMs !== undefined && !settled)
      timer = setTimeout(
        () => finish(() => reject(new Error(o.timeoutMessage ?? 'Timeout'))),
        o.timeoutMs,
      );
    p.then(
      (v) => (settled ? o.release?.(v) : finish(() => resolve(v))),
      (e) => finish(() => reject(e)),
    );
  });
}

/** Socket rejected before `open`; carries the close code/reason for a readable message. */
export class SocketClosedError extends Error {
  constructor(
    readonly code: number,
    readonly reason: string,
  ) {
    super(`Realtime socket closed before open (code ${code})`);
    this.name = 'SocketClosedError';
  }
}

type Socket = Pick<WebSocket, 'readyState' | 'close'> & {
  onopen: WebSocket['onopen'];
  onclose: WebSocket['onclose'];
};

/**
 * Resolves with the socket once open. Abort or timeout closes it; a close before open rejects
 * with SocketClosedError. Handlers set here are cleared, so the caller attaches its own after.
 */
export function openSocket<S extends Socket>(
  create: () => S,
  signal: AbortSignal,
  timeoutMs = START_STAGE_TIMEOUT_MS,
): Promise<S> {
  if (signal.aborted) return Promise.reject(new StartAbortedError());
  const ws = create();
  const opened = new Promise<S>((resolve, reject) => {
    ws.onopen = () => resolve(ws);
    ws.onclose = (e) => reject(new SocketClosedError(e.code, e.reason));
  });
  return abortable(opened, signal, { timeoutMs, timeoutMessage: SOCKET_TIMEOUT_MESSAGE }).then(
    (s) => {
      s.onopen = s.onclose = null;
      return s;
    },
    (e: unknown) => {
      ws.onopen = ws.onclose = null;
      if (ws.readyState <= WebSocket.OPEN) ws.close(1000, 'client stop');
      throw e;
    },
  );
}
