import { notifications } from '@mantine/notifications';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { PCM_RATE } from '~/lib/pcm-player';
import { bytesToBase64, createResampler, floatToPcm16 } from '~/lib/realtime-audio';
import { flushThenCommit, type Mic, startMic } from '~/lib/realtime-mic';
import {
  buildAppend,
  buildCommit,
  buildSessionUpdate,
  closeMessage,
  type RealtimeOptions,
  realtimeErrorMessage,
  realtimeUrl,
} from '~/lib/realtime-protocol';
import { type IncomingEvent, initialRealtimeState, realtimeReducer } from '~/lib/realtime-state';

// A server `error` right before a close already explained it; skip the second notification.
const ERROR_EXPLAINS_CLOSE_MS = 2000;

type Live = { ws: WebSocket | null; mic: Mic | null; stopped: boolean; lastErrorAt: number };

const fail = (title: string, message: string) =>
  notifications.show({ color: 'red', title, message, autoClose: 8000 });

function parse(data: unknown): IncomingEvent | null {
  if (typeof data !== 'string') return null;
  try {
    const v = JSON.parse(data) as unknown;
    return v && typeof v === 'object' && typeof (v as { type?: unknown }).type === 'string'
      ? (v as IncomingEvent)
      : null;
  } catch (e) {
    // Size only — the payload may carry transcript text.
    console.warn('realtime: unparseable server message', { bytes: data.length, error: String(e) });
    return null;
  }
}

/** Mic → /api/v1/realtime transcription session; tears everything down on stop and unmount. */
export function useRealtimeTranscription() {
  const [state, dispatch] = useReducer(realtimeReducer, initialRealtimeState);
  const live = useRef<Live | null>(null);
  const [committing, setCommitting] = useState(false);

  const teardown = useCallback((s: Live | null) => {
    if (!s) return;
    s.stopped = true;
    if (s.ws) {
      s.ws.onopen = s.ws.onmessage = s.ws.onclose = null;
      if (s.ws.readyState <= WebSocket.OPEN) s.ws.close(1000, 'client stop');
    }
    void s.mic?.stop().catch((e) => console.warn('realtime: mic release failed', String(e)));
    if (live.current === s) live.current = null;
  }, []);

  useEffect(() => () => teardown(live.current), [teardown]);

  const stop = useCallback(() => {
    teardown(live.current);
    dispatch({ type: 'local.closed', lost: false });
  }, [teardown]);

  const start = useCallback(
    async (opts: RealtimeOptions) => {
      teardown(live.current);
      const s: Live = { ws: null, mic: null, stopped: false, lastErrorAt: 0 };
      live.current = s;
      dispatch({ type: 'local.connecting' });

      let resample: ((x: Float32Array) => Float32Array) | null = null;
      const onFrames = (frame: Float32Array, rate: number) => {
        if (s.ws?.readyState !== WebSocket.OPEN) return;
        resample ??= createResampler(rate, PCM_RATE);
        const pcm = floatToPcm16(resample(frame));
        if (pcm.length) s.ws.send(JSON.stringify(buildAppend(bytesToBase64(pcm))));
      };
      try {
        s.mic = await startMic(onFrames);
        if (s.stopped) return teardown(s);
      } catch (e) {
        if (s.stopped) return;
        teardown(s);
        dispatch({ type: 'local.closed', lost: false });
        return fail('Mikrofon tidak bisa dipakai', (e as Error).message);
      }

      let opened = false;
      const ws = new WebSocket(realtimeUrl(window.location));
      s.ws = ws;
      ws.onopen = () => {
        opened = true;
        dispatch({ type: 'local.open' });
        ws.send(JSON.stringify(buildSessionUpdate(opts)));
      };
      ws.onmessage = (m) => {
        const ev = parse(m.data);
        if (!ev) return;
        dispatch(ev);
        if (ev.type === 'error') {
          s.lastErrorAt = Date.now();
          fail('Realtime error', realtimeErrorMessage(ev.error));
        }
      };
      ws.onclose = (e) => {
        teardown(s);
        dispatch({ type: 'local.closed', lost: true });
        if (Date.now() - s.lastErrorAt > ERROR_EXPLAINS_CLOSE_MS)
          fail('Koneksi realtime berakhir', closeMessage(e.code, e.reason, opened));
      };
    },
    [teardown],
  );

  // The worklet holds up to one frame (~100 ms) of the last word; flush it before committing.
  const commit = useCallback(async () => {
    const s = live.current;
    if (!s?.mic || s.ws?.readyState !== WebSocket.OPEN) return;
    setCommitting(true);
    try {
      await flushThenCommit(s.mic, s.ws, JSON.stringify(buildCommit()));
    } finally {
      setCommitting(false);
    }
  }, []);

  return { state, start, stop, commit, committing };
}
