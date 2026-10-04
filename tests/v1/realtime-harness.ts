/** test-only: in-process /api/v1/realtime server + a small WebSocket client that records server events. */
import { api } from '../../server/api';
import type { VadOptions } from '../../server/engines/stt/vad';
import { type RtUpgrader, realtimeWebsocket, serveApi } from '../../server/v1/realtime-server';
import { fakeStt, SESSION_TOKEN } from './fake-stt';

// biome-ignore lint/suspicious/noExplicitAny: test-only, server events are loosely shaped JSON
export type Ev = Record<string, any>;

let ipSeq = 0;
const nextIp = () => `10.232.${(++ipSeq >> 8) & 255}.${ipSeq & 255}`;

/** Bun.serve wired exactly like server/prod.ts (plain ws; `tls` for the SDK test). */
export function startServer(tls?: { cert: string; key: string }) {
  return Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    ...(tls ? { tls: { cert: Bun.file(tls.cert), key: Bun.file(tls.key) } } : {}),
    websocket: realtimeWebsocket,
    fetch: (r, s) => serveApi(r, s as unknown as RtUpgrader, (x) => api.handle(x)),
  });
}

/** An upgrade request handled in-process; `upgrade` is what the fake Bun server answers. */
export function upgradeRequest(headers: Record<string, string> = {}, upgrade = true) {
  const req = new Request('http://localhost/api/v1/realtime', {
    headers: { upgrade: 'websocket', 'x-forwarded-for': nextIp(), ...headers },
  });
  return serveApi(req, { upgrade: () => upgrade }, (x) => api.handle(x));
}

/** Connect as the stubbed signed-in user; `events` fills as server events arrive. */
export function connect(port: number, query = '') {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/v1/realtime${query}`, {
    headers: { authorization: `Bearer ${SESSION_TOKEN}`, 'x-forwarded-for': nextIp() },
  } as unknown as string[]);
  const events: Ev[] = [];
  let closeCode: number | null = null;
  ws.onmessage = (m) => events.push(JSON.parse(String(m.data)));
  ws.onclose = (e) => (closeCode = e.code);
  const opened = new Promise<void>((res, rej) => {
    ws.onopen = () => res();
    ws.onerror = () => rej(new Error('ws error'));
  });
  return {
    ws,
    events,
    get closeCode() {
      return closeCode;
    },
    opened,
    send: (ev: Ev) => ws.send(JSON.stringify(ev)),
    types: () => events.map((e) => e.type),
    /** Wait for the n-th (1-based) event of `type`. */
    async next(type: string, n = 1, timeoutMs = 3000): Promise<Ev> {
      const until = Date.now() + timeoutMs;
      for (;;) {
        const hit = events.filter((e) => e.type === type)[n - 1];
        if (hit) return hit;
        if (Date.now() > until)
          throw new Error(`no ${type} #${n}; got ${events.map((e) => e.type).join(',')}`);
        await Bun.sleep(5);
      }
    },
    async closed(timeoutMs = 3000): Promise<number> {
      const until = Date.now() + timeoutMs;
      while (closeCode === null) {
        if (Date.now() > until) throw new Error('socket did not close');
        await Bun.sleep(5);
      }
      return closeCode;
    },
  };
}

/** 24 kHz PCM16 base64 chunks (100 ms each): `amp` 0 = silence, >0 = a 440 Hz tone. */
export function pcmChunks(ms: number, amp: number): string[] {
  const out: string[] = [];
  for (let done = 0; done < ms; done += 100) {
    const n = Math.round((Math.min(100, ms - done) * 24_000) / 1000);
    const pcm = new Int16Array(n);
    for (let i = 0; i < n; i++)
      pcm[i] = Math.round(amp * 32767 * Math.sin((2 * Math.PI * 440 * i) / 24_000));
    out.push(Buffer.from(pcm.buffer).toString('base64'));
  }
  return out;
}

/** Scripted stand-in for Silero: 32 ms frames with peak above 0.1 count as speech (spans in seconds). */
export async function fakeVad(audio: Float32Array, _o: VadOptions): Promise<[number, number][]> {
  const F = 512;
  const spans: [number, number][] = [];
  for (let i = 0; i < audio.length; i += F) {
    let peak = 0;
    for (let j = i; j < Math.min(i + F, audio.length); j++)
      peak = Math.max(peak, Math.abs(audio[j]));
    if (peak < 0.1) continue;
    const s = i / 16_000;
    const e = Math.min(i + F, audio.length) / 16_000;
    const last = spans.at(-1);
    if (last && Math.abs(last[1] - s) < 1e-9) last[1] = e;
    else spans.push([s, e]);
  }
  return spans;
}

/** Give/take the fake engine a `vad` method (server_vad availability is decided per upgrade). */
export function setFakeVad(on: boolean) {
  const f = fakeStt as typeof fakeStt & { vad?: typeof fakeVad };
  if (on) f.vad = fakeVad;
  else delete f.vad;
}

/** session.update body as the RT-U browser sends it. */
export const transcriptionUpdate = (turnDetection: Ev | null, extra: Ev = {}) => ({
  type: 'session.update',
  session: {
    type: 'transcription',
    audio: {
      input: {
        format: { type: 'audio/pcm', rate: 24_000 },
        transcription: { model: 'whisper-1', language: 'id', ...extra },
        turn_detection: turnDetection,
      },
    },
  },
});
