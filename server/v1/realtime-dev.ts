/**
 * Dev-only bridge: node:http (which also carries Vite HMR) cannot hand a socket to Bun's WebSocket server,
 * so /api/v1/realtime upgrades are piped byte-for-byte to an internal loopback Bun.serve.
 */
import type { Server as HttpServer, IncomingMessage } from 'node:http';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import { logger } from '../logger';
import { stampClientIp } from '../middleware/client-ip';
import { realtimeWebsocket, serveApi } from './realtime-server';

const REALTIME_PATH = '/api/v1/realtime';

const g = globalThis as typeof globalThis & {
  __s4sRealtimeDev?: { stop(force?: boolean): unknown };
};

/** Route `upgrade` requests for /api/v1/realtime on `server` to the shared realtime handler. */
export function attachRealtimeDevBridge(
  server: HttpServer,
  handle: (r: Request) => Response | Promise<Response>,
): void {
  // --hot re-runs dev.ts in the same process: drop the previous inner server first.
  g.__s4sRealtimeDev?.stop(true);
  /** Pipe socket's local port → real client IP (the inner server only sees 127.0.0.1). */
  const peers = new Map<number, string>();
  const inner = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    websocket: realtimeWebsocket,
    fetch(request, srv) {
      if (new URL(request.url).pathname !== REALTIME_PATH)
        return new Response('Not found', { status: 404 });
      const peer = srv.requestIP(request);
      stampClientIp(request, (peer && peers.get(peer.port)) ?? peer?.address);
      return serveApi(request, srv, handle);
    },
  });
  g.__s4sRealtimeDev = inner;
  process.once('exit', () => inner.stop(true));

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    // Everything else (Vite HMR) is handled by Vite's own upgrade listener.
    if ((req.url ?? '').split('?')[0] !== REALTIME_PATH) return;
    const upstream = net.connect(inner.port as number, '127.0.0.1');
    let localPort: number | undefined;
    const fail = (side: string) => (err: Error) => {
      logger.warn({ err, side, url: REALTIME_PATH }, 'realtime dev bridge pipe error');
      socket.destroy();
      upstream.destroy();
    };
    upstream.on('error', fail('upstream'));
    socket.on('error', fail('client'));
    upstream.once('connect', () => {
      localPort = upstream.localPort;
      if (localPort) peers.set(localPort, req.socket.remoteAddress ?? '');
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2)
        lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on('close', () => {
      if (localPort) peers.delete(localPort);
      socket.destroy();
    });
    socket.on('close', () => upstream.destroy());
  });
}
