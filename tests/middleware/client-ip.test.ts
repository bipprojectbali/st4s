import { afterEach, describe, expect, it } from 'bun:test';
import {
  CLIENT_IP_HEADER,
  isTrustedProxy,
  normalizeIp,
  RESOLVED_IP_HEADER,
  resolveClientIp,
  stampClientIp,
} from '../../server/middleware/client-ip';

const ORIGINAL = process.env.TRUSTED_PROXIES;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.TRUSTED_PROXIES;
  else process.env.TRUSTED_PROXIES = ORIGINAL;
});

/** Headers as an HTTP entry leaves them: socket IP stamped plus whatever the client sent. */
const fromSocket = (socket: string, extra: Record<string, string> = {}) => {
  const req = new Request('http://localhost/api/x', { headers: extra });
  stampClientIp(req, socket);
  return req.headers;
};

describe('resolveClientIp — in-process requests (no socket stamp)', () => {
  it('reads the first X-Forwarded-For hop, then X-Real-IP', () => {
    expect(resolveClientIp(new Headers({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1' }))).toBe(
      '203.0.113.5',
    );
    expect(resolveClientIp(new Headers({ 'x-real-ip': '::ffff:198.51.100.7' }))).toBe(
      '198.51.100.7',
    );
    expect(resolveClientIp(new Headers())).toBeNull();
  });
});

describe('resolveClientIp — no trusted proxies (default)', () => {
  it('uses the socket IP even when forwarding headers are spoofed', () => {
    delete process.env.TRUSTED_PROXIES;
    const h = fromSocket('::ffff:9.9.9.9', {
      'x-forwarded-for': '1.2.3.4',
      'x-real-ip': '5.6.7.8',
    });
    expect(resolveClientIp(h)).toBe('9.9.9.9');
    expect(resolveClientIp(fromSocket('::1', { 'x-forwarded-for': '1.2.3.4' }))).toBe('127.0.0.1');
  });

  it('uses an explicit socket IP, and returns null when the socket is unknown', () => {
    process.env.TRUSTED_PROXIES = '';
    expect(resolveClientIp(new Headers({ 'x-forwarded-for': '1.2.3.4' }), '::ffff:10.1.2.3')).toBe(
      '10.1.2.3',
    );
    const req = new Request('http://localhost/api/x', {
      headers: { 'x-forwarded-for': '1.2.3.4' },
    });
    stampClientIp(req, null);
    expect(resolveClientIp(req.headers)).toBeNull();
  });
});

describe('resolveClientIp — TRUSTED_PROXIES', () => {
  it('loopback proxy: right-most untrusted X-Forwarded-For hop wins', () => {
    process.env.TRUSTED_PROXIES = 'loopback';
    const h = fromSocket('::1', { 'x-forwarded-for': '6.6.6.6, 203.0.113.9' });
    expect(resolveClientIp(h)).toBe('203.0.113.9');
  });

  it('skips trusted hops from the right (CIDR), then falls back to X-Real-IP and the peer', () => {
    process.env.TRUSTED_PROXIES = 'loopback, 10.0.0.0/8';
    const chain = { 'x-forwarded-for': '6.6.6.6, 203.0.113.9, 10.1.1.1' };
    expect(resolveClientIp(fromSocket('127.0.0.1', chain))).toBe('203.0.113.9');
    expect(resolveClientIp(fromSocket('127.0.0.1', { 'x-real-ip': '198.51.100.2' }))).toBe(
      '198.51.100.2',
    );
    expect(resolveClientIp(fromSocket('127.0.0.1'))).toBe('127.0.0.1');
    expect(resolveClientIp(fromSocket('127.0.0.1', { 'x-forwarded-for': '10.2.2.2' }))).toBe(
      '10.2.2.2',
    );
  });

  it('ignores forwarding headers from an untrusted peer', () => {
    process.env.TRUSTED_PROXIES = '10.0.0.1';
    expect(resolveClientIp(fromSocket('8.8.8.8', { 'x-forwarded-for': '1.2.3.4' }))).toBe(
      '8.8.8.8',
    );
    expect(resolveClientIp(fromSocket('10.0.0.1', { 'x-forwarded-for': '1.2.3.4' }))).toBe(
      '1.2.3.4',
    );
  });

  it('parses IPv6 entries and ignores invalid ones', () => {
    process.env.TRUSTED_PROXIES = 'fd00::/8, not-an-ip, 10.0.0.0/99';
    expect(isTrustedProxy('fd12::1')).toBe(true);
    expect(isTrustedProxy('10.0.0.1')).toBe(false);
    expect(isTrustedProxy('garbage')).toBe(false);
  });
});

describe('stampClientIp', () => {
  it('overwrites a spoofed internal header with the socket address', () => {
    const req = new Request('http://localhost/api/x', {
      headers: { [CLIENT_IP_HEADER]: '1.1.1.1' },
    });
    stampClientIp(req, '::ffff:9.9.9.9');
    expect(req.headers.get(CLIENT_IP_HEADER)).toBe('9.9.9.9');
  });

  it('blanks the header when no socket address is known', () => {
    const req = new Request('http://localhost/api/x', {
      headers: { [CLIENT_IP_HEADER]: '1.1.1.1' },
    });
    stampClientIp(req, null);
    expect(req.headers.get(CLIENT_IP_HEADER)).toBe('');
  });
});

describe('stampClientIp — resolved IP header', () => {
  const resolvedFrom = (socket: string | null, extra: Record<string, string> = {}) => {
    const req = new Request('http://localhost/api/x', { headers: extra });
    stampClientIp(req, socket);
    return req.headers.get(RESOLVED_IP_HEADER);
  };

  it('spoofed X-Forwarded-For from an untrusted peer resolves to the peer', () => {
    delete process.env.TRUSTED_PROXIES;
    expect(resolvedFrom('::ffff:9.9.9.9', { 'x-forwarded-for': '1.2.3.4' })).toBe('9.9.9.9');
  });

  it('trusted loopback proxy resolves to the right-most untrusted hop', () => {
    process.env.TRUSTED_PROXIES = 'loopback';
    expect(resolvedFrom('::1', { 'x-forwarded-for': '6.6.6.6, 203.0.113.9' })).toBe('203.0.113.9');
  });

  it('overwrites a client-sent resolved header, blanking it when the socket is unknown', () => {
    delete process.env.TRUSTED_PROXIES;
    expect(resolvedFrom('8.8.8.8', { [RESOLVED_IP_HEADER]: '1.1.1.1' })).toBe('8.8.8.8');
    expect(resolvedFrom(null, { [RESOLVED_IP_HEADER]: '1.1.1.1' })).toBe('');
  });
});

describe('normalizeIp', () => {
  it('canonicalizes loopback and IPv4-mapped forms', () => {
    expect(normalizeIp('::1')).toBe('127.0.0.1');
    expect(normalizeIp('::ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(normalizeIp('  ')).toBeNull();
  });
});
