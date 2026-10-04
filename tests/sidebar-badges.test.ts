/** /dev sidebar counters: one badge per menu, sane tones, short-lived cache. */
import { describe, expect, test } from 'bun:test';
import type { EngineStatus } from '../server/engines/types';
import { devSidebarBadges, engineBadge } from '../server/sidebar-badges';

describe('devSidebarBadges', () => {
  test('returns a numeric badge with tooltip and tone for every console menu it covers', async () => {
    const badges = await devSidebarBadges({ fresh: true });
    const expected = [
      '/dev/users',
      '/dev/sessions',
      '/dev/posts',
      '/dev/api-keys',
      '/dev/db-schema',
      '/dev/visits',
      '/dev/login-logs',
      '/dev/rate-limit-logs',
      '/dev/server-logs',
      '/dev/audit',
      '/dev/settings',
      '/dev/tools',
    ];
    for (const route of expected) {
      const b = badges[route];
      expect(b).toBeDefined();
      expect(Number.isInteger(b.value) && b.value >= 0).toBe(true);
      expect(b.tone === 'alert' || b.tone === 'info').toBe(true);
      if (b.value > 0) expect(b.tooltip).toBeTruthy();
    }
    // Attention badges carry a color; scale badges are gray.
    expect(badges['/dev/rate-limit-logs'].color).toBe('red');
    expect(badges['/dev/db-schema'].color).toBe('red');
    expect(badges['/dev/users'].color === 'gray' || badges['/dev/users'].color === 'orange').toBe(
      true,
    );
    expect(badges['/dev/visits'].tone).toBe('info');
  });
  test('serves the same promise within the cache window', async () => {
    const a = devSidebarBadges();
    const b = devSidebarBadges();
    expect(a).toBe(b);
    expect(await devSidebarBadges({ fresh: true })).not.toBe(await a);
  });
  test('engine badge: none when unregistered, alert on error, else loaded count', () => {
    const st = (kind: 'stt' | 'tts', state: EngineStatus['state']): EngineStatus => ({
      kind,
      model: 'm',
      state,
      queued: 0,
      loadedAt: null,
      lastError: state === 'error' ? 'boom' : null,
      rssBytes: null,
      stats: { requests: 0, errors: 0, p50Ms: null, p95Ms: null, rtfP50: null },
    });
    expect(engineBadge([])).toBeNull();
    expect(engineBadge([st('stt', 'ready'), st('tts', 'unloaded')])).toMatchObject({
      value: 1,
      tone: 'info',
    });
    const err = engineBadge([st('stt', 'error'), st('tts', 'ready')]);
    expect(err).toMatchObject({ value: 1, tone: 'alert', color: 'red' });
    expect(err?.tooltip).toContain('boom');
  });
});
