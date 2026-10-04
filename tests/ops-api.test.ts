import { describe, expect, it } from 'bun:test';
import { formatUptime, mcpConfigSnippet } from '../app/lib/ops-api';

describe('ops-api helpers', () => {
  it('formatUptime picks the right unit', () => {
    expect(formatUptime(90)).toBe('1 menit');
    expect(formatUptime(3 * 3600 + 120)).toBe('3 jam 2 menit');
    expect(formatUptime(2 * 86_400 + 5 * 3600)).toBe('2 hari 5 jam');
  });
  it('mcpConfigSnippet references the env var, never a literal key', () => {
    const s = mcpConfigSnippet('http://localhost:3005/api/mcp');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the literal env placeholder
    expect(s).toContain('${ST4S_MCP_KEY}');
    expect(s).not.toContain('mk_live_');
    expect(s).toContain('http://localhost:3005/api/mcp');
  });
});
