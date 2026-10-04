/**
 * Development server: a single port serving BOTH the Elysia API and the
 * React Router SSR app with Vite HMR.
 *
 * We use a real Node http server (Bun implements node:http) so Vite's
 * connect-style middleware gets genuine req/res objects:
 *  - `/api/*`  -> Elysia (via web Request/Response bridge)
 *  - assets/HMR -> Vite middleware
 *  - everything else -> React Router SSR handler (loaded via Vite, HMR-aware)
 */
import { createServer } from 'node:http';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createRequestHandler } from 'react-router';
import { createServer as createViteServer } from 'vite';
import { api } from './api';
import { newRequestId } from './api-error';
import { db } from './db';
import { bootEngines, exitOnShutdownSignals } from './engines/boot';
import { env } from './env';
import { errorResponse } from './error-page';
import { nodeToWebRequest, writeWebResponse } from './http-bridge';
import { isHttpProbe, probeResponse } from './http-probes';
import { logger } from './logger';
import { stampClientIp } from './middleware/client-ip';
import { recordVisit } from './middleware/visitor';
import { agentDocResponse, isAgentDoc } from './readme';
import { isSeoFile, seoResponse } from './seo';
import { getBranding } from './settings-branding';
import { maintenanceGate } from './settings-maintenance';

// Dev-only (this entry runs only under `bun run dev`): sync the local DB schema
// on boot so a fresh or behind database doesn't 500 on first query. Prod
// migrates as an explicit deploy step, never on boot.
try {
  await migrate(db, { migrationsFolder: './server/db/migrations' });
} catch (err) {
  logger.error({ err }, 'auto-migrate on boot failed; continuing');
}

// Engines are lazy: this registers them without starting a child or loading a model.
bootEngines();
exitOnShutdownSignals();

const server = createServer((req, res) => {
  const pathname = (req.url ?? '/').split('?')[0];

  // API + auth -> Elysia.
  if (pathname.startsWith('/api')) {
    (async () => {
      try {
        const request = await nodeToWebRequest(req);
        stampClientIp(request, req.socket.remoteAddress);
        const response = await api.handle(request);
        await writeWebResponse(res, response);
      } catch (err) {
        // Bridge-level failure (before Elysia's own error handler could run).
        const requestId = newRequestId();
        logger.error({ err, requestId, path: pathname }, 'API bridge error');
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.setHeader('x-request-id', requestId);
        res.end(
          JSON.stringify({
            error: 'Terjadi kesalahan di server',
            code: 'INTERNAL',
            status: 500,
            requestId,
          }),
        );
      }
    })();
    return;
  }

  // Browser/devtools probes (e.g. Chrome's com.chrome.devtools.json): plain 404,
  // never SSR, never counted as a visit.
  if (isHttpProbe(pathname)) {
    void writeWebResponse(res, probeResponse(pathname));
    return;
  }

  // Plain-text docs for agents (/README.md, /llms.txt): no SSR, no visit log.
  if (isAgentDoc(pathname)) {
    void nodeToWebRequest(req)
      .then((request) => agentDocResponse(request, pathname))
      .then((response) => writeWebResponse(res, response));
    return;
  }

  // Crawler files (/robots.txt, /sitemap.xml): no SSR, no visit log.
  if (isSeoFile(pathname)) {
    void nodeToWebRequest(req).then((request) =>
      writeWebResponse(res, seoResponse(request, pathname)),
    );
    return;
  }

  // Assets + HMR via Vite, then fall through to React Router SSR.
  vite.middlewares(req, res, async () => {
    try {
      const build = await vite.ssrLoadModule('virtual:react-router/server-build');
      const handler = createRequestHandler(build as never, 'development');
      const request = await nodeToWebRequest(req);
      stampClientIp(request, req.socket.remoteAddress);
      // Maintenance mode answers before SSR (and is not counted as a visit).
      const blocked = await maintenanceGate(request, (await getBranding()).appName);
      if (blocked) {
        await writeWebResponse(res, blocked);
        return;
      }
      void recordVisit(request);
      const response = await handler(request);
      await writeWebResponse(res, response);
    } catch (err) {
      vite.ssrFixStacktrace(err as Error);
      const requestId = newRequestId();
      logger.error({ err, requestId, path: pathname }, 'SSR error');
      await writeWebResponse(res, errorResponse({ status: 500, requestId }));
    }
  });
});

// HMR rides the app's own port. Without `ws.server`, middleware mode opens a
// second WebSocket port (24678) that collides when two projects run at once.
// `port` keeps the client's direct-connect fallback off Vite's default 5173.
const vite = await createViteServer({
  server: { middlewareMode: true, port: env.PORT, ws: { server } },
  appType: 'custom',
});

server.listen(env.PORT, () => {
  logger.info(`\u{1F680} Makuro dev server on http://localhost:${env.PORT}`);
});
