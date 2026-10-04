import { describe, expect, it } from 'bun:test';
import { env } from '../server/env';
import { shouldSkip } from '../server/middleware/visitor';
import { isSeoFile, robotsTxt, seoResponse, sitemapXml } from '../server/seo';
import { isMaintenanceExempt } from '../server/settings-maintenance';

const SITE = 'https://st4s.example/'; // test-only

describe('robots.txt', () => {
  it('keeps crawlers out of auth flows, role areas and the API, and points to the sitemap', () => {
    const txt = robotsTxt(SITE);
    for (const p of ['/api/', '/login', '/go', '/banned', '/profile', '/dashboard', '/dev'])
      expect(txt).toContain(`Disallow: ${p}\n`);
    expect(txt).toContain('Allow: /\n');
    expect(txt).toContain('Sitemap: https://st4s.example/sitemap.xml');
  });
});

describe('sitemap.xml', () => {
  it('lists only the public landing page with an absolute URL', () => {
    const xml = sitemapXml(SITE);
    expect(xml.startsWith('<?xml')).toBe(true);
    expect([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])).toEqual([
      'https://st4s.example/',
    ]);
  });
});

describe('seoResponse', () => {
  it('serves both files with their content type, built from APP_URL', async () => {
    const robots = seoResponse(new Request('http://x/robots.txt'), '/robots.txt');
    expect(robots.headers.get('content-type')).toContain('text/plain');
    expect(robots.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await robots.text()).toBe(robotsTxt(env.APP_URL));

    const sitemap = seoResponse(new Request('http://x/sitemap.xml'), '/sitemap.xml');
    expect(sitemap.headers.get('content-type')).toContain('application/xml');
    expect(sitemap.headers.get('cache-control')).toContain('max-age=');
  });

  it('answers HEAD without a body', async () => {
    const res = seoResponse(new Request('http://x/robots.txt', { method: 'HEAD' }), '/robots.txt');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });
});

describe('crawler and icon paths', () => {
  it('are recognised, not counted as visits, and served during maintenance', () => {
    expect(isSeoFile('/robots.txt')).toBe(true);
    expect(isSeoFile('/sitemap.xml')).toBe(true);
    expect(isSeoFile('/robots')).toBe(false);
    for (const p of [
      '/robots.txt',
      '/sitemap.xml',
      '/site.webmanifest',
      '/og.png',
      '/apple-touch-icon.png',
    ]) {
      expect(shouldSkip(p)).toBe(true);
      expect(isMaintenanceExempt(p)).toBe(true);
    }
  });
});
