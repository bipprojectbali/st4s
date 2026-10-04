/** Admission control for speech work: wakes the guard, sheds new requests with 503 while RAM is low, and refuses cold loads that do not fit the RAM budget. */
import { Elysia } from 'elysia';
import { newRequestId } from '../api-error';
import { v1Error } from '../v1/errors';
import { BUDGET_MESSAGE } from './budget';
import type { GuardEngine } from './machine';
import { type Admission, guardHandle } from './state';

/** User-facing reason for a shed request (Indonesian, actionable). */
export const SHED_MESSAGE = (retryAfterSec: number) =>
  `RAM server sedang menipis, permintaan audio baru ditunda sementara. Coba lagi dalam ${retryAfterSec} detik.`;

/** Which engine each /v1 route loads; other /v1/audio/* routes are only shed, never budget-checked. */
export const ENGINE_BY_V1_PATH: Readonly<Record<string, GuardEngine>> = {
  '/audio/transcriptions': 'stt',
  '/audio/speech': 'tts',
};

/** Ask the running guard whether new speech work (that may load `engine`) may start; always admits when no guard runs. */
export function admitSpeechWork(engine?: GuardEngine): Admission {
  return guardHandle()?.admit(engine) ?? { ok: true };
}

/** Message for a refused admission (shed or budget). */
export function admissionMessage(a: Exclude<Admission, { ok: true }>): string {
  return a.reason === 'budget' ? BUDGET_MESSAGE(a) : SHED_MESSAGE(a.retryAfterSec);
}

/** Scoped plugin for the /v1 router: applies to /v1/audio/* routes registered after it. */
export const memoryGuardPlugin = new Elysia({ name: 'memory-guard' }).onBeforeHandle(
  { as: 'scoped' },
  ({ request }) => {
    const path = new URL(request.url).pathname;
    const i = path.indexOf('/v1/audio/');
    if (i < 0) return;
    const a = admitSpeechWork(ENGINE_BY_V1_PATH[path.slice(i + 3)]);
    if (a.ok) return;
    return v1Error(503, admissionMessage(a), {
      code: 'memory_pressure',
      headers: {
        'retry-after': String(a.retryAfterSec),
        'x-request-id': request.headers.get('x-request-id') ?? newRequestId(),
      },
    });
  },
);
