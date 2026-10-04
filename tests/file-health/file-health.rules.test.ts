import { describe, expect, it } from 'bun:test';
import {
  adviceFor,
  classifyFile,
  estimateTokens,
  hazardFor,
  IGNORED_DIRS,
  isTextFile,
  statusFor,
} from '../../server/file-health/file-health.rules';

describe('IGNORED_DIRS', () => {
  it('skips the vendored libcrispasr build from scripts/crispasr/build.sh', () => {
    expect(IGNORED_DIRS.has('.crispasr')).toBe(true);
  });
});

describe('classifyFile', () => {
  it('maps project paths to kinds', () => {
    expect(classifyFile('server/api/admin.ts')).toBe('route');
    expect(classifyFile('server/middleware/visitor.ts')).toBe('route');
    expect(classifyFile('server/mcp/tools/db.ts')).toBe('route');
    expect(classifyFile('server/auth.ts')).toBe('service');
    expect(classifyFile('server/mcp/index.ts')).toBe('service');
    expect(classifyFile('server/db/schema.ts')).toBe('schema');
    expect(classifyFile('server/api/analytics-visits.query.ts')).toBe('repository');
    expect(classifyFile('server/db/index.ts')).toBe('repository');
    expect(classifyFile('server/types/pino-roll.d.ts')).toBe('types');
    expect(classifyFile('app/lib/visits-api.ts')).toBe('utility');
    expect(classifyFile('app/routes/super/visits.tsx')).toBe('component');
    expect(classifyFile('app/components/AppFrame.tsx')).toBe('component');
    expect(classifyFile('app/components/DbSchemaGraph.tsx')).toBe('component');
    expect(classifyFile('server/db/schema-introspect.ts')).toBe('schema');
    expect(classifyFile('server/api/analytics-visits.stats.query.ts')).toBe('repository');
    expect(classifyFile('tests/api/admin.test.ts')).toBe('test');
    expect(classifyFile('vite.config.ts')).toBe('config');
    expect(classifyFile('package.json')).toBe('config');
    expect(classifyFile('README.md')).toBe('docs');
    expect(classifyFile('stack.md')).toBe('docs');
  });

  it('excludes generated, migration, seed, fixture and lock files', () => {
    expect(classifyFile('server/db/migrations/0004_x.sql')).toBe('excluded');
    expect(classifyFile('server/db/migrations/meta/0004_snapshot.json')).toBe('excluded');
    expect(classifyFile('app/types.generated.ts')).toBe('excluded');
    expect(classifyFile('tests/__fixtures__/x.json')).toBe('excluded');
    expect(classifyFile('bun.lock')).toBe('excluded');
    expect(classifyFile('.agents/skills/react-flow/SKILL.md')).toBe('excluded');
  });
});

describe('statusFor', () => {
  it('uses the per-kind limit with a warn band at 80%', () => {
    expect(statusFor('route', 100, 3000)).toBe('ok');
    expect(statusFor('route', 120, 3000)).toBe('warn');
    expect(statusFor('route', 151, 3000)).toBe('over');
    expect(statusFor('test', 399, 9000)).toBe('warn');
  });

  it('applies the global hard limit even to kinds without a line limit', () => {
    expect(statusFor('docs', 501, 100)).toBe('over');
    expect(statusFor('docs', 100, 20_001)).toBe('over');
    expect(statusFor('docs', 400, 19_000)).toBe('ok');
    expect(statusFor('excluded', 9999, 999_999)).toBe('excluded');
  });
});

describe('token hazard', () => {
  it('estimates ~4 chars per token and bands hazards', () => {
    expect(estimateTokens(400)).toBe(100);
    expect(hazardFor(4_999)).toBe('none');
    expect(hazardFor(5_000)).toBe('caution');
    expect(hazardFor(15_000)).toBe('danger');
  });

  it('gives actionable advice per band', () => {
    expect(adviceFor('danger', 27_000)).toContain('Jangan baca utuh');
    expect(adviceFor('caution', 6_000)).toContain('offset/limit');
    expect(adviceFor('none', 300)).toContain('Aman');
  });
});

describe('isTextFile', () => {
  it('accepts source/config/doc extensions and known basenames', () => {
    expect(isTextFile('a/b.tsx')).toBe(true);
    expect(isTextFile('bun.lock')).toBe(true);
    expect(isTextFile('Dockerfile')).toBe(true);
    expect(isTextFile('public/favicon.svg')).toBe(true);
  });

  it('rejects binaries', () => {
    expect(isTextFile('st4s')).toBe(false);
    expect(isTextFile('img/logo.png')).toBe(false);
  });
});
