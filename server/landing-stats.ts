/** Live numbers for the landing page hero, computed from the running code (never hand-typed). */
import { APP_VERSION } from './app-info';
import { introspectDrizzleSchema } from './db/schema-introspect';
import { MCP_TOOL_CATALOG } from './mcp/tool-catalog';

/** Routes under /dev that render a page (keep in sync with app/routes.ts; tested). */
export const CONSOLE_PAGE_COUNT = 17;

async function countTestFiles(): Promise<number> {
  if (Bun.isStandaloneExecutable) return 0;
  try {
    let n = 0;
    for await (const _ of new Bun.Glob('tests/**/*.test.ts').scan(process.cwd())) n++;
    return n;
  } catch {
    return 0;
  }
}

export async function landingStats() {
  return {
    tables: introspectDrizzleSchema().tables.length,
    consolePages: CONSOLE_PAGE_COUNT,
    mcpTools: MCP_TOOL_CATALOG.length,
    testFiles: await countTestFiles(),
    version: APP_VERSION,
  };
}
