/**
 * File health rules: which files are checked, their line limits by role, and
 * how "dangerous" a file is for an AI agent's context window.
 *
 * Limits mirror the project's file-health convention (see ~/.claude/CLAUDE.md
 * rule 8). React pages/components are not covered there; we treat them like
 * services (300 lines) as a project convention.
 */

export type FileKind =
  | 'route'
  | 'service'
  | 'repository'
  | 'schema'
  | 'types'
  | 'utility'
  | 'config'
  | 'test'
  | 'component'
  | 'docs'
  | 'excluded'
  | 'other';

export type HealthStatus = 'ok' | 'warn' | 'over' | 'excluded';
export type ContextHazard = 'none' | 'caution' | 'danger';

/** Line limits per kind; null = no per-kind limit (hard limit still applies). */
export const KIND_LIMITS: Record<FileKind, number | null> = {
  route: 150,
  service: 300,
  repository: 250,
  schema: 200,
  types: 300,
  utility: 200,
  config: 100,
  test: 400,
  component: 300,
  docs: null,
  excluded: null,
  other: null,
};

export const KIND_LABELS: Record<FileKind, string> = {
  route: 'Route / handler',
  service: 'Service',
  repository: 'Repository / query',
  schema: 'Schema / validation',
  types: 'Types',
  utility: 'Utility',
  config: 'Config',
  test: 'Test',
  component: 'Page / component',
  docs: 'Docs',
  excluded: 'Dikecualikan',
  other: 'Lainnya',
};

/** Global hard limit for every non-excluded file. */
export const HARD_LIMIT_LINES = 500;
export const HARD_LIMIT_CHARS = 20_000;
/** Files at or above this share of their limit are flagged "warn". */
export const WARN_RATIO = 0.8;

/** Rough token estimate: ~4 characters per token for code/English text. */
export const CHARS_PER_TOKEN = 4;
/** Estimated tokens at which reading the whole file starts to hurt an agent's context. */
export const HAZARD_CAUTION_TOKENS = 5_000;
export const HAZARD_DANGER_TOKENS = 15_000;

/** Directories never scanned (build output, deps, VCS, caches, runtime logs). */
export const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'build',
  '.react-router',
  '.vite',
  'logs',
  'dist',
  'coverage',
  '.claude',
  '.crispasr',
]);

/** Text file extensions we can count lines for. Anything else is treated as binary and skipped. */
const TEXT_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'json',
  'md',
  'mdx',
  'css',
  'scss',
  'html',
  'svg',
  'yml',
  'yaml',
  'toml',
  'sql',
  'txt',
  'sh',
  'env',
  'example',
  'lock',
  'xml',
  'csv',
]);
const TEXT_BASENAMES = new Set([
  'Dockerfile',
  'LICENSE',
  '.gitignore',
  '.dockerignore',
  '.env.example',
]);

export function isTextFile(relPath: string): boolean {
  const base = relPath.split('/').pop() ?? relPath;
  if (TEXT_BASENAMES.has(base)) return true;
  const ext = base.includes('.') ? (base.split('.').pop() ?? '').toLowerCase() : '';
  return TEXT_EXTENSIONS.has(ext);
}

/** Classify a repo-relative posix path into a file kind. First match wins. */
export function classifyFile(relPath: string): FileKind {
  const p = relPath.toLowerCase();
  const base = p.split('/').pop() ?? p;
  const depth = p.split('/').length;

  if (
    p.startsWith('.agents/') || // vendored agent skills — external content, not ours to size
    p.includes('/migrations/') ||
    p.includes('.generated.') ||
    p.includes('/seed') ||
    p.includes('__fixtures__') ||
    p.includes('__mocks__') ||
    base.endsWith('.lock') ||
    base === 'package-lock.json'
  ) {
    return 'excluded';
  }
  if (p.startsWith('tests/') || base.includes('.test.') || base.includes('.spec.')) return 'test';
  if (base.endsWith('.d.ts') || p.includes('/types/') || base === 'types.ts') return 'types';
  if (base.endsWith('.md') || base.endsWith('.mdx') || base === 'license') return 'docs';
  if (depth === 1) {
    if (
      base.endsWith('.config.ts') ||
      base.endsWith('.json') ||
      base.endsWith('.yml') ||
      base === 'dockerfile'
    ) {
      return 'config';
    }
  }
  // Data-access files live next to their routes but are sized as queries.
  if (base.endsWith('.query.ts')) return 'repository';
  if (/^schema[-.]|\.schema\.|validation/.test(base) && !base.endsWith('.tsx')) return 'schema';
  if (
    p.startsWith('server/api/') ||
    p.startsWith('server/middleware/') ||
    p.startsWith('server/mcp/tools/')
  ) {
    return 'route';
  }
  if (p.startsWith('server/db/') || p.includes('/repositor')) return 'repository';
  if (p.startsWith('server/')) return 'service';
  if (
    p.startsWith('app/lib/') ||
    p.startsWith('app/stores/') ||
    p.includes('/utils') ||
    p.includes('/helpers') ||
    base.endsWith('-format.ts')
  ) {
    return 'utility';
  }
  if (p.startsWith('app/')) return 'component';
  return 'other';
}

export function estimateTokens(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

export function hazardFor(estTokens: number): ContextHazard {
  if (estTokens >= HAZARD_DANGER_TOKENS) return 'danger';
  if (estTokens >= HAZARD_CAUTION_TOKENS) return 'caution';
  return 'none';
}

export function statusFor(kind: FileKind, lines: number, chars: number): HealthStatus {
  if (kind === 'excluded') return 'excluded';
  const limit = KIND_LIMITS[kind];
  if (lines > HARD_LIMIT_LINES || chars > HARD_LIMIT_CHARS) return 'over';
  if (limit === null) return 'ok';
  if (lines > limit) return 'over';
  if (lines >= limit * WARN_RATIO) return 'warn';
  return 'ok';
}

/** One-line guidance for an agent deciding whether to read the file whole. */
export function adviceFor(hazard: ContextHazard, estTokens: number): string {
  const t = estTokens.toLocaleString('id-ID');
  if (hazard === 'danger')
    return `Jangan baca utuh (~${t} token). Gunakan grep/rg atau baca rentang baris tertentu.`;
  if (hazard === 'caution') return `Baca sebagian dengan offset/limit — utuh sekitar ${t} token.`;
  return `Aman dibaca utuh (~${t} token).`;
}
