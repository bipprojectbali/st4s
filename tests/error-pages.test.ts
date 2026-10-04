/** Error copy catalog (client) and the dependency-free HTML fallback (server). */
import { describe, expect, test } from 'bun:test';
import { describeError, errorReference, kindForStatus } from '../app/lib/error-page';
import { errorHtml, errorResponse, escapeHtml } from '../server/error-page';

describe('describeError', () => {
  test('maps statuses to kinds and copy', () => {
    expect(kindForStatus(404)).toBe('not-found');
    expect(kindForStatus(403)).toBe('forbidden');
    expect(kindForStatus(401)).toBe('unauthorized');
    expect(kindForStatus(503)).toBe('unavailable');
    expect(kindForStatus(502)).toBe('server');
    expect(kindForStatus(418)).toBe('other');
    // Shape React Router gives boundaries for thrown/unmatched routes (isRouteErrorResponse).
    const nf = describeError({ status: 404, statusText: 'Not Found', internal: true, data: null });
    expect(nf.status).toBe(404);
    expect(nf.title).toBe('Halaman tidak ditemukan');
  });
  test('hides technical detail unless in development', () => {
    const err = new Error('db down');
    expect(describeError(err).detail).toBeNull();
    expect(describeError(err, true).detail).toContain('db down');
    expect(describeError(err).status).toBe(500);
    expect(errorReference(1_700_000_000_000)).toMatch(/^ERR-[0-9A-Z]{6}$/);
  });
});

describe('errorHtml', () => {
  test('renders status, copy, request id and escapes input', async () => {
    const html = errorHtml({ status: 500, requestId: 'abc123', appName: '<st4s>' });
    expect(html).toContain('Terjadi kesalahan di server');
    expect(html).toContain('abc123');
    expect(html).toContain('&lt;st4s&gt;');
    expect(html).not.toContain('<st4s>');
    expect(html).toContain('noindex');
    const res = errorResponse({ status: 503, requestId: 'r1' });
    expect(res.status).toBe(503);
    expect(res.headers.get('x-request-id')).toBe('r1');
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('sementara tidak tersedia');
    expect(escapeHtml('a"b')).toBe('a&quot;b');
  });
});
