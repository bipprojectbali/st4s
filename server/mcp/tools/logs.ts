import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { LEVEL_NAMES, logBuffer } from '../log-buffer';

function formatEntry(entry: ReturnType<typeof logBuffer.query>[number]): string {
  const time = new Date(entry.time).toISOString();
  const level = (LEVEL_NAMES[entry.level] ?? String(entry.level)).toUpperCase().padEnd(5);
  const { level: _l, time: _t, msg: _m, env: _e, ...rest } = entry;
  const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
  return `[${time}] ${level} ${entry.msg}${extra}`;
}

export function registerLogTools(server: McpServer) {
  server.registerTool(
    'get_recent_errors',
    {
      description:
        'Get recent warn/error/fatal log entries from the in-memory ring buffer (last 500 entries).',
      inputSchema: {
        limit: z.number().min(1).max(200).optional().describe('Max entries to return (default 50)'),
        level: z
          .enum(['warn', 'error', 'fatal'])
          .optional()
          .describe('Minimum log level to include (default "warn")'),
      },
    },
    async (args) => {
      const entries = logBuffer.query({ limit: args.limit ?? 50, level: args.level ?? 'warn' });
      const text =
        entries.length === 0
          ? `No ${args.level ?? 'warn'}+ entries in buffer (${logBuffer.size()} total entries buffered).`
          : entries.map(formatEntry).join('\n');
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.registerTool(
    'search_logs',
    {
      description: 'Search in-memory log entries by text query (case-insensitive).',
      inputSchema: {
        query: z.string().min(1).describe('Text to search (case-insensitive, matches any field)'),
        limit: z.number().min(1).max(200).optional().describe('Max entries to return (default 50)'),
        since: z
          .string()
          .optional()
          .describe('ISO 8601 datetime — return only entries after this time'),
      },
    },
    async (args) => {
      const sinceMs = args.since ? new Date(args.since).getTime() : undefined;
      const entries = logBuffer.query({
        search: args.query,
        limit: args.limit ?? 50,
        since: sinceMs,
      });
      const text =
        entries.length === 0
          ? `No entries matching "${args.query}" (${logBuffer.size()} total entries buffered).`
          : entries.map(formatEntry).join('\n');
      return { content: [{ type: 'text' as const, text }] };
    },
  );
}
