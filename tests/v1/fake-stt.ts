/** test-only: scriptable SttEngine + request helpers for driving the real /api app through app.handle(). */
import { spyOn } from 'bun:test';
import { api } from '../../server/api';
import { auth } from '../../server/auth';
import { SttUnloadedError } from '../../server/engines/stt/errors';
import { EngineBusyError, type SttEngine, type TranscribeRequest, type TranscribeResult } from '../../server/engines/types';
import * as rolesMod from '../../server/roles';

export const TRANSCRIPT: TranscribeResult = {
  text: 'Halo dunia. Apa kabar?',
  language: 'id',
  duration: 1,
  segments: [
    {
      id: 0,
      start: 0,
      end: 0.5,
      text: 'Halo dunia.',
      words: [
        { word: 'Halo', start: 0, end: 0.2 },
        { word: 'dunia.', start: 0.2, end: 0.5 },
      ],
    },
    { id: 1, start: 0.5, end: 1, text: ' Apa kabar?', words: [{ word: 'Apa', start: 0.5, end: 0.7 }] },
  ],
};
export const DELTAS = ['Halo', ' dunia.', ' Apa kabar?'];

// Read through a function so status() keeps the EngineStatus type (fakeStt's own `this` is Record<string, unknown>).
const fakeQueued = (): number => fakeStt.queued;

type Mode = 'ok' | 'busy' | 'boom' | 'unloaded' | 'hang-after-delta' | 'boom-after-delta';

/** Fake engine: `mode` picks the behaviour, `last` keeps the last request, `aborted` flips when the signal fires. */
export const fakeStt = {
  mode: 'ok' as Mode,
  last: null as TranscribeRequest | null,
  aborted: false,
  /** Reported as status().queued, to drive the route's queue-full check. */
  queued: 0,
  async transcribe(req: TranscribeRequest): Promise<TranscribeResult> {
    this.last = req;
    req.signal?.addEventListener('abort', () => (this.aborted = true), { once: true });
    if (this.mode === 'busy') throw new EngineBusyError('stt', 7);
    if (this.mode === 'boom') throw new Error('child process exploded at /secret/path');
    if (this.mode === 'unloaded') throw new SttUnloadedError();
    if (this.mode === 'boom-after-delta') {
      req.onDelta?.(DELTAS[0]);
      await Bun.sleep(1);
      throw new Error('child crashed mid-stream');
    }
    if (this.mode === 'hang-after-delta') {
      req.onDelta?.(DELTAS[0]);
      return new Promise((_, reject) => req.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    }
    for (const d of DELTAS) {
      await Bun.sleep(1);
      req.onDelta?.(d);
    }
    return TRANSCRIPT;
  },
  status() {
    return {
    kind: 'stt' as const,
    model: 'fake',
    state: 'ready' as const,
    queued: fakeQueued(),
    loadedAt: null,
    lastError: null,
    rssBytes: null,
    stats: { requests: 0, errors: 0, p50Ms: null, p95Ms: null, rtfP50: null },
    };
  },
  warmup: async () => {},
  unload: async () => {},
} satisfies SttEngine & Record<string, unknown>;

export const resetFake = () => Object.assign(fakeStt, { mode: 'ok', last: null, aborted: false, queued: 0 });

/** Bearer token the stubbed session lookup treats as a signed-in user (not an mk_live key). */
export const SESSION_TOKEN = 'test-session-token';

/** Stub Better Auth's session lookup + role reconciliation (real guard keeps running). */
export function stubSession() {
  return [
    spyOn(auth.api, 'getSession').mockImplementation((async ({ headers }: { headers: Headers }) =>
      headers.get('authorization') === `Bearer ${SESSION_TOKEN}`
        ? { user: { id: 'v1-test-user', email: 'v1@test.local', banned: false }, session: { id: 's' } }
        : null) as unknown as typeof auth.api.getSession),
    spyOn(rolesMod, 'resolveUserRole').mockImplementation(async () => 'user'),
  ];
}

let ipSeq = 0;
/** Unique client IP per request, so the shared in-memory rate limiter never trips across test files. */
export function withIp(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  ipSeq++;
  headers.set('x-forwarded-for', `10.231.${(ipSeq >> 8) & 255}.${ipSeq & 255}`);
  return { ...init, headers };
}

/** fetch for the openai SDK that routes into the in-process app. */
export const appFetch = (url: string | URL | Request, init?: RequestInit) =>
  api.handle(new Request(url, withIp(init)));

/** Call the app directly. */
export const call = (path: string, init?: RequestInit) => api.handle(new Request(`http://localhost${path}`, withIp(init)));

/** multipart body with the given string fields + a file. */
export function form(fields: Record<string, string | string[]>, file: Uint8Array<ArrayBuffer> | null, name = 'a.wav') {
  const fd = new FormData();
  if (file) fd.set('file', new File([file], name, { type: 'audio/wav' }));
  for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) fd.append(k, x);
  return fd;
}
