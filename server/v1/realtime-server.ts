/** Bun WebSocket plumbing for /api/v1/realtime, shared by server/prod.ts and the dev bridge. */
import type { ServerWebSocket } from 'bun';
import type { SttEngine } from '../engines/types';
import { RT_MAX_FRAME_BYTES } from './realtime-config';
import type { RtProblem } from './realtime-protocol';
import { createRealtimeSession, type RtContext } from './realtime-session';

/** Per-socket data set at upgrade time. */
export type RtSocketData = {
  ctx: RtContext;
  engine: SttEngine;
  /** Reject right after open with an error event (unsupported ?intent). */
  reject: RtProblem | null;
  session?: ReturnType<typeof createRealtimeSession>;
};

/** The part of Bun.Server the route needs. */
export type RtUpgrader = {
  upgrade(req: Request, opts: { data: RtSocketData; headers?: Record<string, string> }): boolean;
};

const g = globalThis as typeof globalThis & {
  __s4sRealtime?: {
    active: number;
    upgraders: WeakMap<Request, RtUpgrader>;
    upgraded: WeakSet<Request>;
  };
};
// globalThis: the SSR bundle copy and --hot reloads must share one session counter.
g.__s4sRealtime ??= { active: 0, upgraders: new WeakMap(), upgraded: new WeakSet() };
const state = g.__s4sRealtime;

/** Open realtime sessions (including ones upgrading right now). */
export const realtimeActiveSessions = () => state.active;

/** Take a session slot if fewer than `max` are open. */
export function reserveRealtimeSlot(max: number): boolean {
  if (state.active >= max) return false;
  state.active++;
  return true;
}

/** Give a slot back (failed upgrade or closed socket). */
export function releaseRealtimeSlot(): void {
  state.active = Math.max(0, state.active - 1);
}

/** Bun.Server that can upgrade `req`, when it came through serveApi. */
export const upgraderFor = (req: Request) => state.upgraders.get(req);

/** Record that the route upgraded `req`, so serveApi returns no response. */
export const markUpgraded = (req: Request) => void state.upgraded.add(req);

/** Bun.serve fetch for /api: lets the realtime route upgrade; returns undefined once upgraded. */
export async function serveApi(
  request: Request,
  server: RtUpgrader,
  handle: (r: Request) => Response | Promise<Response>,
): Promise<Response | undefined> {
  state.upgraders.set(request, server);
  const res = await handle(request);
  return state.upgraded.has(request) ? undefined : res;
}

/** Bun.serve `websocket` handler; frames above RT_MAX_FRAME_BYTES are closed by Bun with 1009. */
export const realtimeWebsocket = {
  maxPayloadLength: RT_MAX_FRAME_BYTES,
  open(ws: ServerWebSocket<RtSocketData>) {
    const d = ws.data;
    d.session = createRealtimeSession(
      {
        send: (ev) => void ws.send(JSON.stringify(ev)),
        close: (code, reason) => ws.close(code, reason),
      },
      d.engine,
      d.ctx,
    );
    d.session.open();
    if (d.reject) d.session.reject(d.reject);
  },
  message(ws: ServerWebSocket<RtSocketData>, msg: string | Buffer) {
    ws.data.session?.message(msg);
  },
  close(ws: ServerWebSocket<RtSocketData>, code: number) {
    ws.data.session?.closed(code);
    releaseRealtimeSlot();
  },
};
