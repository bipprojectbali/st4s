/** GET /api/v1/realtime: OpenAI Realtime WebSocket, transcription sessions only; every refusal happens before the upgrade. */
import { Elysia } from 'elysia';
import { newRequestId } from '../api-error';
import { getApiKeyIdentity } from '../api-keys/identity';
import { getStt } from '../engines/registry';
import { hasVad } from '../engines/stt/vad';
import type { SttEngine } from '../engines/types';
import { env } from '../env';
import { logger } from '../logger';
import { admissionMessage, admitSpeechWork } from '../memory-guard/plugin';
import { normalizeIp, resolveClientIp } from '../middleware/client-ip';
import { resolveGeo } from '../middleware/visitor-geo';
import { requireV1Caller } from './auth';
import { v1Error } from './errors';
import { rtConfig } from './realtime-config';
import { newId } from './realtime-protocol';
import {
  markUpgraded,
  realtimeActiveSessions,
  releaseRealtimeSlot,
  reserveRealtimeSlot,
  upgraderFor,
} from './realtime-server';

/** Cookie sessions must come from our own origin (no cross-site WebSocket hijacking); API keys carry no ambient authority. */
function originAllowed(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    const o = new URL(origin);
    return (
      o.host === request.headers.get('host') || o.origin === new URL(env.BETTER_AUTH_URL).origin
    );
  } catch {
    return false;
  }
}

type RefusalOpts = Parameters<typeof v1Error>[2] & { code: string };

/** A pre-upgrade refusal: one warn line (ids, code, limits; never user content) plus the OpenAI-shaped error. */
function refuse(
  requestId: string,
  status: number,
  message: string,
  opts: RefusalOpts,
  extra: Record<string, unknown> = {},
): Response {
  logger.warn({ requestId, code: opts.code, status, ...extra }, 'realtime upgrade refused');
  return v1Error(status, message, opts);
}

const requestIdOf = (request: Request) => request.headers.get('x-request-id') ?? newRequestId();

function upgradeRealtime(request: Request): Response {
  const requestId = requestIdOf(request);
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket')
    return refuse(
      requestId,
      426,
      'Endpoint ini hanya menerima koneksi WebSocket (Upgrade: websocket).',
      { code: 'upgrade_required', headers: { upgrade: 'websocket' } },
    );
  const identity = getApiKeyIdentity(request);
  if (!identity && !originAllowed(request))
    return refuse(
      requestId,
      403,
      'Origin tidak diizinkan untuk sesi login. Buka dari situs ini atau pakai API key.',
      { code: 'origin_not_allowed' },
    );
  const admission = admitSpeechWork('stt');
  if (!admission.ok)
    return refuse(
      requestId,
      503,
      admissionMessage(admission),
      { code: 'memory_pressure', headers: { 'retry-after': String(admission.retryAfterSec) } },
      admission,
    );
  let engine: SttEngine;
  try {
    engine = getStt();
  } catch (err) {
    logger.error({ err, requestId }, 'stt engine not registered');
    return v1Error(503, 'Mesin STT belum siap. Coba lagi sebentar lagi.', {
      code: 'engine_unavailable',
    });
  }
  const server = upgraderFor(request);
  if (!server)
    return refuse(requestId, 426, 'Server ini tidak bisa meng-upgrade koneksi ke WebSocket.', {
      code: 'upgrade_required',
    });
  if (!reserveRealtimeSlot(rtConfig.maxSessions))
    return refuse(
      requestId,
      429,
      `Maksimal ${rtConfig.maxSessions} sesi realtime bersamaan. Tutup sesi lain lalu coba lagi.`,
      { code: 'too_many_sessions', headers: { 'retry-after': '10' } },
      { active: realtimeActiveSessions(), max: rtConfig.maxSessions },
    );

  const intent = new URL(request.url).searchParams.get('intent');
  const offered = (request.headers.get('sec-websocket-protocol') ?? '')
    .split(',')
    .some((p) => p.trim() === 'realtime');
  const ok = server.upgrade(request, {
    data: {
      engine,
      ctx: {
        sessionId: newId('sess'),
        requestId,
        keyId: identity?.keyId ?? null,
        ip: normalizeIp(resolveClientIp(request.headers)),
        country: resolveGeo(request.headers).country,
        userAgent: request.headers.get('user-agent'),
        vadAvailable: hasVad(engine),
      },
      reject:
        intent && intent !== 'transcription'
          ? {
              code: 'unsupported_session_type',
              param: 'intent',
              message: `intent '${intent.slice(0, 32)}' tidak didukung: server ini hanya melayani sesi transkripsi (intent=transcription).`,
            }
          : null,
    },
    // Echo the subprotocol only when offered: an unrequested one makes clients fail with 1002.
    ...(offered ? { headers: { 'Sec-WebSocket-Protocol': 'realtime' } } : {}),
  });
  if (!ok) {
    releaseRealtimeSlot();
    return refuse(requestId, 400, 'Upgrade WebSocket gagal.', { code: 'upgrade_failed' });
  }
  markUpgraded(request);
  return new Response(null);
}

/** Realtime route; auth (API key or login) runs before the handler, like the HTTP v1 routes. */
export const realtimeApi = new Elysia()
  .onBeforeHandle(async ({ request }) => {
    const denied = await requireV1Caller({ request });
    if (denied)
      logger.warn(
        { requestId: requestIdOf(request), code: 'invalid_api_key', status: denied.status },
        'realtime upgrade refused',
      );
    return denied;
  })
  .get('/realtime', ({ request }) => upgradeRealtime(request));
