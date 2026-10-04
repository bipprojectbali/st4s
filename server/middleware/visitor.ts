/**
 * Visitor analytics middleware for Elysia.
 *
 * Records every incoming request to `visit_log`. Bot detection uses the
 * `isbot` package (UA heuristics — catches ~67% of bots including GPTBot,
 * ClaudeBot, Googlebot, etc.).
 *
 * Each row is enriched with geo (proxy headers), parsed device info, referer
 * and language — see visitor-geo.ts and visitor-ua.ts.
 *
 * Skipped paths: /api/auth/* (high-frequency auth polling) and static assets.
 */
import { isbot, isbotMatch } from 'isbot';
import { auth } from '../auth';
import { db } from '../db';
import { visitLog } from '../db/schema';
import { resolveClientIp } from './client-ip';
import { primaryLanguage, resolveGeo, sanitizeReferer } from './visitor-geo';
import { parseUserAgent } from './visitor-ua';

// UA strings are unbounded client input; cap what we persist.
const MAX_UA_LENGTH = 512;

// Skip all API calls and internal browser requests — visitor tracking should only
// cover page navigations, not same-origin fetch requests from the SPA.
const SKIP_PREFIXES = [
  '/api/',
  '/_vite/',
  '/assets/',
  '/favicon',
  '/manifest',
  '/__manifest',
  '/.well-known/', // browser/devtools probes, see http-probes.ts
  '/README.md',
  '/readme.md',
  '/llms', // agent docs, see server/readme.ts
  '/skill.md',
  '/robots.txt', // crawler files, see server/seo.ts
  '/sitemap.xml',
  '/site.webmanifest',
  '/og.png',
  '/apple-touch-icon',
];

/** True for requests that are not page navigations (API, assets, loaders, probes). */
export function shouldSkip(path: string): boolean {
  // React Router loader fetches end with .data (e.g. /posts.data) — not page navigations.
  if (path.endsWith('.data')) return true;
  return SKIP_PREFIXES.some((p) => path.startsWith(p));
}

// Kept as a re-export so existing imports/tests keep working.
export { normalizeIp } from './client-ip';

function classifyBot(ua: string): string | null {
  const match = isbotMatch(ua);
  if (!match) return null;
  const lower = ua.toLowerCase();
  if (/gptbot|chatgpt|openai/.test(lower)) return 'ai:openai';
  if (/claude|anthropic/.test(lower)) return 'ai:anthropic';
  if (/bingbot|bingpreview/.test(lower)) return 'search:bing';
  if (/googlebot|google-extended|google-inspectiontool/.test(lower)) return 'search:google';
  if (/ccbot/.test(lower)) return 'ai:cc';
  // Moz crawls as rogerbot/dotbot; a bare "moz" would also match every "Mozilla/5.0" UA.
  if (/semrush|ahrefs|rogerbot|dotbot/.test(lower)) return 'seo-crawler';
  if (/uptimerobot|pingdom|statuspage/.test(lower)) return 'monitor';
  return match;
}

export async function recordVisit(request: Request, explicitIp?: string | null): Promise<void> {
  try {
    const url = new URL(request.url);
    if (shouldSkip(url.pathname)) return;

    const ua = request.headers.get('user-agent') ?? '';
    const bot = isbot(ua);
    const botKind = bot ? classifyBot(ua) : null;

    // Resolve the logged-in user (best-effort) so page views can be attributed.
    // getSession relies on the Better Auth cookie cache — no DB hit on the hot path.
    let userId: string | null = null;
    try {
      const session = await auth.api.getSession({ headers: request.headers });
      userId = session?.user.id ?? null;
    } catch {
      userId = null;
    }

    // Proxy headers first, then the socket IP stamped by dev.ts/prod.ts (or passed explicitly).
    const ip = resolveClientIp(request.headers, explicitIp);

    const device = parseUserAgent(ua, request.headers, bot);
    const geo = resolveGeo(request.headers);

    await db
      .insert(visitLog)
      .values({
        ip,
        path: url.pathname,
        userAgent: ua ? ua.slice(0, MAX_UA_LENGTH) : null,
        isBot: bot,
        botKind,
        userId,
        referer: sanitizeReferer(request.headers.get('referer')),
        country: geo.country,
        region: geo.region,
        city: geo.city,
        browser: device.browser,
        browserVersion: device.browserVersion,
        os: device.os,
        osVersion: device.osVersion,
        deviceType: device.deviceType,
        language: primaryLanguage(request.headers.get('accept-language')),
      })
      .catch(() => {
        // Silently drop — analytics must not crash the request pipeline.
      });
  } catch {
    // Never let analytics errors surface to the user.
  }
}
