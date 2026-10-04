/**
 * Plain-text documentation for AI agents and other non-browser clients, all
 * from the single README.md:
 *  - /README.md, /readme.md  → text/markdown, the file as-is
 *  - /llms-full.txt          → same content as text/plain (llmstxt.org convention)
 *  - /llms.txt               → short index built from the README headings
 *  - /skill.md               → docs/skill.md (API usage guide), {{BASE_URL}} → APP_URL
 * No JavaScript, no SSR, no visit logging; ETag so polling agents get 304s.
 * Dev reads the file on every request; prod/binary serve the build-time copy.
 */
import path from 'node:path';
import bundledSkill from '../docs/skill.md' with { type: 'text' };
import bundledReadme from '../README.md' with { type: 'text' };
import { APP_VERSION } from './app-info';
import { env, isProd } from './env';

const ROUTES = {
  '/README.md': 'markdown',
  '/readme.md': 'markdown',
  '/llms-full.txt': 'text',
  '/llms.txt': 'index',
  '/skill.md': 'skill',
} as const;
type Variant = (typeof ROUTES)[keyof typeof ROUTES];
const CACHE_SECONDS = 300;
const README_PATH = path.join(import.meta.dir, '../README.md');
const SKILL_PATH = path.join(import.meta.dir, '../docs/skill.md');

export function isAgentDoc(pathname: string): pathname is keyof typeof ROUTES {
  return pathname in ROUTES;
}

/** Live file in development so edits show immediately; bundled text in prod/binary or if the file is gone. */
async function sourceText(file: string, bundled: string): Promise<string> {
  if (isProd || Bun.isStandaloneExecutable) return bundled;
  try {
    return await Bun.file(file).text();
  } catch {
    return bundled;
  }
}

/** README source (see sourceText). */
export const readmeText = () => sourceText(README_PATH, bundledReadme);

/** docs/skill.md with every {{BASE_URL}} replaced by the app's public URL (no trailing slash). */
export async function skillText(appUrl: string): Promise<string> {
  return (await sourceText(SKILL_PATH, bundledSkill)).replaceAll(
    '{{BASE_URL}}',
    appUrl.replace(/\/$/, ''),
  );
}

const etagOf = (s: string) => `"${Bun.hash(s).toString(16)}"`;

/** llms.txt: H1 title, one-line summary, links to the full docs and the README sections. */
export function llmsIndex(readme: string, appUrl: string, version = APP_VERSION): string {
  const title =
    readme
      .match(/^#\s+(.+)$/m)?.[1]
      ?.replace(/[⚡]/g, '')
      .trim() || 'App';
  const summary =
    readme
      .split('\n')
      .find((l) => l.trim() && !l.startsWith('#') && !l.startsWith('```'))
      ?.replace(/\*\*/g, '')
      .trim() ?? '';
  const sections = [...readme.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].replace(/`/g, '').trim());
  const base = appUrl.replace(/\/$/, '');
  return [
    `# ${title}`,
    '',
    `> ${summary}`,
    '',
    `Versi ${version}. Dokumentasi berasal dari README.md; panduan pemakaian Speech API dari docs/skill.md.`,
    '',
    '## Dokumentasi',
    '',
    `- [Pakai API ini (skill)](${base}/skill.md): Speech API kompatibel OpenAI — auth, contoh SDK, endpoint, kode error`,
    `- [README lengkap (markdown)](${base}/README.md): arsitektur, setup, API, auth, API key, MCP`,
    `- [README lengkap (teks polos)](${base}/llms-full.txt)`,
    '',
    '## Endpoint untuk agent',
    '',
    `- [Versi build](${base}/api/version): JSON { name, version, env, bun }, publik`,
    `- [MCP server](${base}/api/mcp): Streamable HTTP, autentikasi Authorization: Bearer <API key ber-scope mcp>`,
    `- [API](${base}/api): header X-API-Key atau Authorization: Bearer mk_live_…; error selalu JSON { error, code, status, requestId }`,
    '',
    '## Bagian README',
    '',
    ...sections.map((s) => `- ${s}`),
    '',
  ].join('\n');
}

export async function agentDocResponse(
  request: Request,
  pathname: keyof typeof ROUTES,
): Promise<Response> {
  const variant: Variant = ROUTES[pathname];
  const body =
    variant === 'skill'
      ? await skillText(env.APP_URL)
      : variant === 'index'
        ? llmsIndex(await readmeText(), env.APP_URL)
        : await readmeText();
  const etag = etagOf(body);
  const headers = {
    etag,
    'cache-control': `public, max-age=${CACHE_SECONDS}`,
    'content-type':
      variant === 'markdown' || variant === 'skill'
        ? 'text/markdown; charset=utf-8'
        : 'text/plain; charset=utf-8',
    'x-content-type-options': 'nosniff',
  };
  if (request.headers.get('if-none-match') === etag)
    return new Response(null, { status: 304, headers });
  return new Response(request.method === 'HEAD' ? null : body, { status: 200, headers });
}
