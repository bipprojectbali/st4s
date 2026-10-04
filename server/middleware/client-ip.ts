/**
 * Client IP resolution shared by rate limiting, visitor analytics and login logs.
 *
 * dev.ts / prod.ts stamp the socket (peer) IP onto every request as an internal
 * header, always overwriting what the client sent. Forwarding headers
 * (X-Forwarded-For, X-Real-IP) are only believed when that peer is listed in
 * TRUSTED_PROXIES; then the right-most X-Forwarded-For hop that is not itself a
 * trusted proxy is the client. Otherwise the peer IP is the client, so a
 * spoofed X-Forwarded-For cannot dodge rate limits.
 *
 * Requests that never passed an HTTP entry (in-process `app.handle` in tests)
 * carry no stamp and have no network peer to distrust: headers are read as-is.
 */
import { BlockList, isIP } from 'node:net';
import { logger } from '../logger';

/** Set by the HTTP servers from the socket address; never trusted from the wire. */
export const CLIENT_IP_HEADER = 'x-makuro-client-ip';

/** Client IP after the trust rules, set by stampClientIp; the only IP header Better Auth reads. */
export const RESOLVED_IP_HEADER = 'x-makuro-resolved-ip';

/** Canonical, human-readable form (IPv4-mapped → IPv4, IPv6 loopback → 127.0.0.1). */
export function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let ip = raw.trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1') ip = '127.0.0.1';
  return ip || null;
}

let cached: { raw: string; list: BlockList } | null = null;

function trustedProxies(): BlockList {
  const raw = process.env.TRUSTED_PROXIES ?? '';
  if (cached?.raw === raw) return cached.list;
  const list = new BlockList();
  for (const entry of raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (entry === 'loopback') {
      list.addSubnet('127.0.0.0', 8, 'ipv4');
      list.addAddress('::1', 'ipv6');
      continue;
    }
    const [addr, bits] = entry.split('/');
    const family = isIP(addr) === 6 ? 'ipv6' : 'ipv4';
    const prefix = bits === undefined ? null : Number(bits);
    const maxBits = family === 'ipv6' ? 128 : 32;
    if (
      !isIP(addr) ||
      (prefix !== null && !(Number.isInteger(prefix) && prefix >= 0 && prefix <= maxBits))
    ) {
      logger.warn({ entry }, 'TRUSTED_PROXIES: entry is not an IP, CIDR or "loopback"; ignored');
      continue;
    }
    if (prefix === null) list.addAddress(addr, family);
    else list.addSubnet(addr, prefix, family);
  }
  cached = { raw, list };
  return list;
}

/** True when `ip` (normalized) is listed in TRUSTED_PROXIES. */
export function isTrustedProxy(ip: string): boolean {
  const v = isIP(ip);
  return v !== 0 && trustedProxies().check(ip, v === 6 ? 'ipv6' : 'ipv4');
}

const forwardedHops = (headers: Headers): string[] =>
  (headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map(normalizeIp)
    .filter((ip): ip is string => ip !== null);

/** The client IP for this request (see module doc for the trust rules), or null when unknown. */
export function resolveClientIp(headers: Headers, socketIp?: string | null): string | null {
  const stamped = headers.get(CLIENT_IP_HEADER);
  if (stamped === null && !socketIp) {
    return forwardedHops(headers)[0] ?? normalizeIp(headers.get('x-real-ip'));
  }
  const peer = normalizeIp(stamped ?? socketIp);
  if (!peer || !isTrustedProxy(peer)) return peer;
  const hops = forwardedHops(headers);
  for (let i = hops.length - 1; i >= 0; i--) if (!isTrustedProxy(hops[i])) return hops[i];
  return hops[0] ?? normalizeIp(headers.get('x-real-ip')) ?? peer;
}

/** Stamp the socket IP and the resolved client IP (empty when unknown), always overwriting the wire values. */
export function stampClientIp(request: Request, socketIp: string | null | undefined): void {
  request.headers.set(CLIENT_IP_HEADER, normalizeIp(socketIp) ?? '');
  request.headers.set(RESOLVED_IP_HEADER, resolveClientIp(request.headers) ?? '');
}
