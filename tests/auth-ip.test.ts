import { describe, expect, it } from 'bun:test';
import { getIP } from '@better-auth/core/utils/ip';
import { auth } from '../server/auth';
import { RESOLVED_IP_HEADER, stampClientIp } from '../server/middleware/client-ip';

describe('Better Auth client IP', () => {
  it('reads only the resolved IP header', () => {
    expect(auth.options.advanced?.ipAddress?.ipAddressHeaders).toEqual([RESOLVED_IP_HEADER]);
  });

  it('ignores a spoofed X-Forwarded-For from an untrusted peer', () => {
    const prev = process.env.TRUSTED_PROXIES;
    delete process.env.TRUSTED_PROXIES;
    try {
      const req = new Request('http://localhost/api/auth/sign-in/email', {
        headers: { 'x-forwarded-for': '1.2.3.4' },
      });
      stampClientIp(req, '::ffff:9.9.9.9');
      expect(getIP(req, auth.options)).toBe('9.9.9.9');
    } finally {
      if (prev === undefined) delete process.env.TRUSTED_PROXIES;
      else process.env.TRUSTED_PROXIES = prev;
    }
  });
});
