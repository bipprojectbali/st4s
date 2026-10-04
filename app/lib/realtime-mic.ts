/** Microphone capture through an inline AudioWorklet that posts mono Float32 frames every ~100 ms. */

// Worklet → main messages: a Float32Array frame, or this marker answering one flush request.
const FLUSHED = 'flushed';

const PROCESSOR = 's4s-mic-tap';

// Runs on the audio thread: buffers the first input channel and transfers each full frame.
const WORKLET_SRC = `
class MicTap extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.size = options.processorOptions.size;
    this.buf = new Float32Array(this.size);
    this.n = 0;
    // A flush posts the partial buffer (if any), then the marker, on the same ordered port.
    this.port.onmessage = (e) => {
      if (!e.data || e.data.type !== 'flush') return;
      if (this.n > 0) {
        this.port.postMessage(this.buf.slice(0, this.n));
        this.n = 0;
      }
      this.port.postMessage({ type: '${FLUSHED}' });
    };
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.size) {
          this.port.postMessage(this.buf, [this.buf.buffer]);
          this.buf = new Float32Array(this.size);
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('${PROCESSOR}', MicTap);
`;

/** Running capture: `flush` delivers the buffered tail to `onFrames`; `stop` discards it. */
export type Mic = { rate: number; flush: () => Promise<void>; stop: () => Promise<void> };

/** Main-thread side of the worklet port: forwards frames and settles flush() calls in FIFO order. */
export function createMicPort(
  onFrame: (samples: Float32Array) => void,
  post: (msg: { type: 'flush' }) => void,
) {
  const pending: Array<() => void> = [];
  return {
    receive(data: unknown) {
      if (data instanceof Float32Array) onFrame(data);
      else if ((data as { type?: unknown } | null)?.type === FLUSHED) pending.shift()?.();
    },
    flush: () =>
      new Promise<void>((resolve) => {
        pending.push(resolve);
        post({ type: 'flush' });
      }),
    // Settles waiters whose marker will never arrive (capture stopped); they then see a closed socket.
    release() {
      for (const resolve of pending.splice(0)) resolve();
    },
  };
}

/** Delivers the mic tail, then sends `commitMsg` on that same socket only if it is still open. */
export async function flushThenCommit(
  mic: Pick<Mic, 'flush'>,
  ws: Pick<WebSocket, 'readyState' | 'send'>,
  commitMsg: string,
): Promise<boolean> {
  await mic.flush();
  if (ws.readyState !== WebSocket.OPEN) return false;
  ws.send(commitMsg);
  return true;
}

/** Readable Indonesian message for a getUserMedia / AudioWorklet failure. */
export function micErrorMessage(e: unknown): string {
  const name = e instanceof Error ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Izin mikrofon ditolak. Izinkan akses mikrofon untuk situs ini di pengaturan browser, lalu coba lagi.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return 'Mikrofon tidak ditemukan. Sambungkan mikrofon lalu coba lagi.';
  if (name === 'NotReadableError')
    return 'Mikrofon sedang dipakai aplikasi lain. Tutup aplikasi itu lalu coba lagi.';
  const msg = e instanceof Error ? e.message : String(e);
  return `Mikrofon tidak bisa dipakai: ${msg}`;
}

/**
 * Starts capture and calls `onFrames(samples, sampleRate)` per frame. The AudioContext is created
 * before the first await so it stays tied to the click (autoplay policy). Throws a readable Error.
 */
export async function startMic(
  onFrames: (samples: Float32Array, rate: number) => void,
  frameMs = 100,
): Promise<Mic> {
  if (typeof AudioContext === 'undefined' || !navigator.mediaDevices?.getUserMedia)
    throw new Error(
      'Browser ini tidak mendukung perekaman mikrofon. Pakai Chrome, Edge, atau Safari terbaru.',
    );
  const ctx = new AudioContext();
  let stream: MediaStream | null = null;
  const release = async () => {
    for (const t of stream?.getTracks() ?? []) t.stop();
    if (ctx.state !== 'closed') await ctx.close();
  };
  try {
    if (!ctx.audioWorklet)
      throw new Error('AudioWorklet tidak tersedia. Buka konsol lewat HTTPS atau localhost.');
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, PROCESSOR, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      processorOptions: { size: Math.round((ctx.sampleRate * frameMs) / 1000) },
    });
    const port = createMicPort(
      (frame) => onFrames(frame, ctx.sampleRate),
      (msg) => node.port.postMessage(msg),
    );
    node.port.onmessage = (e: MessageEvent<unknown>) => port.receive(e.data);
    source.connect(node);
    // The node writes no output (silence); connecting it keeps every browser pulling the graph.
    node.connect(ctx.destination);
    if (ctx.state === 'suspended') await ctx.resume();
    return {
      rate: ctx.sampleRate,
      flush: port.flush,
      stop: async () => {
        node.port.onmessage = null;
        port.release();
        source.disconnect();
        node.disconnect();
        await release();
      },
    };
  } catch (e) {
    await release();
    throw new Error(micErrorMessage(e), { cause: e });
  }
}
