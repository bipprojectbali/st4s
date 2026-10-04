/** Admission control for speech work: wakes the guard and sheds new requests with 503 while RAM is low. */
import { Elysia } from 'elysia';
import { newRequestId } from '../api-error';
import { v1Error } from '../v1/errors';
import { guardHandle, type Admission } from './state';

/** User-facing reason for a shed request (Indonesian, actionable). */
export const SHED_MESSAGE = (retryAfterSec: number) =>
  `RAM server sedang menipis, permintaan audio baru ditunda sementara. Coba lagi dalam ${retryAfterSec} detik.`;

/** Ask the running guard whether new speech work may start; always admits when no guard runs. */
export function admitSpeechWork(): Admission {
  return guardHandle()?.admit() ?? { ok: true };
}

/** Scoped plugin for the /v1 router: applies to /v1/audio/* routes registered after it. */
export const memoryGuardPlugin = new Elysia({ name: 'memory-guard' }).onBeforeHandle(
  { as: 'scoped' },
  ({ request }) => {
    if (!new URL(request.url).pathname.includes('/v1/audio/')) return;
    const a = admitSpeechWork();
    if (a.ok) return;
    return v1Error(503, SHED_MESSAGE(a.retryAfterSec), {
      code: 'memory_pressure',
      headers: {
        'retry-after': String(a.retryAfterSec),
        'x-request-id': request.headers.get('x-request-id') ?? newRequestId(),
      },
    });
  },
);
