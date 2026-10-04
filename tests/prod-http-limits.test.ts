import { afterEach, describe, expect, it } from 'bun:test';
import {
  IDLE_TIMEOUT_SEC,
  maxRequestBodyBytes,
  needsLongTimeout,
  serveLimits,
} from '../server/http-limits';

const ORIGINAL = process.env.V1_MAX_UPLOAD_MB;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.V1_MAX_UPLOAD_MB;
  else process.env.V1_MAX_UPLOAD_MB = ORIGINAL;
});

describe('needsLongTimeout', () => {
  it('lifts the idle timeout only for speech and engine routes', () => {
    expect(needsLongTimeout('/api/v1/audio/transcriptions')).toBe(true);
    expect(needsLongTimeout('/api/v1/audio/speech')).toBe(true);
    expect(needsLongTimeout('/api/engines/stt/warmup')).toBe(true);
    for (const p of [
      '/api/v1/models',
      '/api/v1/audio',
      '/api/engines',
      '/api/auth/x',
      '/',
      '/dev/engines',
    ]) {
      expect(needsLongTimeout(p)).toBe(false);
    }
  });
});

describe('maxRequestBodyBytes / serveLimits', () => {
  it('derives the body limit from V1_MAX_UPLOAD_MB plus 1 MiB', () => {
    delete process.env.V1_MAX_UPLOAD_MB;
    expect(maxRequestBodyBytes()).toBe(26 * 1024 * 1024);
    process.env.V1_MAX_UPLOAD_MB = '50';
    expect(serveLimits()).toEqual({
      idleTimeout: IDLE_TIMEOUT_SEC,
      maxRequestBodySize: 51 * 1024 * 1024,
    });
  });
});

describe('Bun.serve with the prod limits', () => {
  it('keeps a silent long-route request alive past idleTimeout, cuts others, and 413s big bodies', async () => {
    process.env.V1_MAX_UPLOAD_MB = '1';
    const server = Bun.serve({
      port: 0,
      ...serveLimits(),
      idleTimeout: 1, // test-only: shrink the 60 s window
      async fetch(request, srv) {
        const { pathname } = new URL(request.url);
        if (needsLongTimeout(pathname)) srv.timeout(request, 0);
        if (request.method === 'POST')
          return new Response(String((await request.arrayBuffer()).byteLength));
        await Bun.sleep(5000); // Bun checks idle sockets on a ~4 s tick

        return new Response('done');
      },
    });
    try {
      const base = `http://localhost:${server.port}`;
      const [long, short] = await Promise.allSettled([
        fetch(`${base}/api/v1/audio/transcriptions`).then((r) => r.text()),
        fetch(`${base}/api/v1/models`).then((r) => r.text()),
      ]);
      expect(long).toEqual({ status: 'fulfilled', value: 'done' });
      expect(short.status).toBe('rejected');

      const ok = await fetch(`${base}/api/v1/audio/x`, {
        method: 'POST',
        body: new Uint8Array(1024 * 1024),
      });
      expect(ok.status).toBe(200);
      const big = await fetch(`${base}/api/v1/audio/x`, {
        method: 'POST',
        body: new Uint8Array(3 * 1024 * 1024),
      });
      expect(big.status).toBe(413);
    } finally {
      server.stop(true);
    }
  }, 15_000);
});
