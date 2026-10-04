/**
 * Integration tests for the MCP Streamable HTTP endpoint (server/mcp/index.ts +
 * tools). Drives the plugin through Elysia's in-memory `app.handle()` — no live
 * server needed — exercising the real handshake, token gate, and every tool.
 *
 * Regression guard: elysia-mcp 0.1.1's SSE writer double-prefixes frames
 * (`data: event: message`), which spec-compliant clients cannot parse. We set
 * `enableJsonResponse: true` so responses are plain application/json; the
 * "JSON framing" block below asserts the whole body parses as one JSON value.
 *
 * Requires MCP_ADMIN_TOKEN (>= 32 chars) in the environment. Without it the
 * plugin returns 503 for everything, so the suite skips rather than false-fail.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import Elysia from 'elysia';
import { db } from '../../server/db';
import { post, session, user } from '../../server/db/schema';
import { mcpPlugin } from '../../server/mcp/index';
import { logBuffer } from '../../server/mcp/log-buffer';

const TOKEN = process.env.MCP_ADMIN_TOKEN;
const app = new Elysia().use(mcpPlugin);

type JsonRpc = Record<string, unknown>;
type RpcOpts = { sid?: string; token?: string | null; query?: string };

const INIT: JsonRpc = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0' },
  },
};

async function rpc(body: JsonRpc, opts: RpcOpts = {}): Promise<Response> {
  const token = 'token' in opts ? opts.token : TOKEN;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.sid) headers['mcp-session-id'] = opts.sid;
  const url = `http://localhost/mcp${opts.query ?? ''}`;
  return app.handle(new Request(url, { method: 'POST', headers, body: JSON.stringify(body) }));
}

// ─── Seed identifiers (created in beforeAll, removed in afterAll) ──────────────
const runId = crypto.randomUUID().slice(0, 8);
const seededUserId = `mcp-user-${runId}`;
const seededEmail = `mcp-${runId}@test.local`;
const seededPostId = `mcp-post-${runId}`;
const activeSessionId = `mcp-sess-active-${runId}`;
const expiredSessionId = `mcp-sess-expired-${runId}`;
const errorSentinel = `MCP-ENDPOINT-SENTINEL-${runId}`;

const describeIf = TOKEN ? describe : describe.skip;

/**
 * Open a fresh MCP session (initialize + notifications/initialized) and return
 * its id. elysia-mcp 0.1.1 shares a single McpServer across sessions, and each
 * initialize rebinds that server's transport — so a session id captured earlier
 * goes stale as soon as another initialize runs (e.g. the auth-gate tests).
 * Opening a session immediately before use keeps the shared server bound to it
 * for the duration of the call (tests run sequentially, no interleaving init).
 */
async function openSession(): Promise<string> {
  const res = await rpc(INIT);
  const s = res.headers.get('mcp-session-id') ?? '';
  await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, { sid: s });
  return s;
}

beforeAll(async () => {
  if (!TOKEN) return;

  await db.insert(user).values({
    id: seededUserId,
    name: `MCP Seed ${runId}`,
    email: seededEmail,
    emailVerified: false,
    role: 'user',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.insert(session).values([
    {
      id: activeSessionId,
      token: `tok-active-${runId}`,
      userId: seededUserId,
      ipAddress: '10.9.9.1',
      expiresAt: new Date(Date.now() + 86_400_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: expiredSessionId,
      token: `tok-expired-${runId}`,
      userId: seededUserId,
      ipAddress: '10.9.9.2',
      expiresAt: new Date(Date.now() - 86_400_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]);
  await db.insert(post).values({
    id: seededPostId,
    title: `MCP seed post ${runId}`,
    authorId: seededUserId,
    createdAt: new Date(),
  });

  logBuffer.push({ level: 50, time: Date.now(), msg: errorSentinel });
});

afterAll(async () => {
  if (!TOKEN) return;
  await db
    .delete(post)
    .where(eq(post.id, seededPostId))
    .catch(() => {});
  await db
    .delete(session)
    .where(eq(session.userId, seededUserId))
    .catch(() => {});
  await db
    .delete(user)
    .where(eq(user.id, seededUserId))
    .catch(() => {});
});

// ─── tools/call helper ────────────────────────────────────────────────────────
async function callTool(name: string, args: Record<string, unknown> = {}) {
  const sid = await openSession();
  const res = await rpc(
    {
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method: 'tools/call',
      params: { name, arguments: args },
    },
    { sid },
  );
  const body = (await res.json()) as {
    result?: { content?: Array<{ text?: string }> };
    error?: unknown;
  };
  const text = body.result?.content?.[0]?.text ?? '';
  return { status: res.status, text, body };
}

// ─── Auth gate ────────────────────────────────────────────────────────────────

describeIf('MCP auth gate', () => {
  test('missing token → 401', async () => {
    const res = await rpc(INIT, { token: null });
    expect(res.status).toBe(401);
  });

  test('wrong token → 401', async () => {
    const res = await rpc(INIT, { token: 'definitely-not-the-real-token-000000' });
    expect(res.status).toBe(401);
  });

  test('token via ?mcpAdminToken query param is accepted', async () => {
    const res = await rpc(INIT, { token: null, query: `?mcpAdminToken=${TOKEN}` });
    expect(res.status).toBe(200);
  });
});

// ─── Streamable HTTP handshake + JSON framing regression guard ────────────────

describeIf('MCP handshake & JSON framing', () => {
  test('initialize returns application/json (not SSE) with a session id', async () => {
    const res = await rpc(INIT);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('mcp-session-id')).toBeTruthy();
  });

  test('body is a single parseable JSON value — not SSE-framed', async () => {
    const res = await rpc(INIT);
    const raw = await res.text();
    // The SSE bug prefixed the body with "data: event: message"; a JSON body
    // starts with "{". Assert both the shape and that JSON.parse sees it whole.
    expect(raw.trimStart().startsWith('{')).toBe(true);
    expect(raw).not.toContain('event: message');
    const parsed = JSON.parse(raw) as { result?: { serverInfo?: { name?: string } } };
    expect(parsed.result?.serverInfo?.name).toBe('st4s-debug');
  });
});

// ─── tools/list ───────────────────────────────────────────────────────────────

describeIf('MCP tools/list', () => {
  test('exposes exactly the 8 debug tools', async () => {
    const sid = await openSession();
    const res = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, { sid });
    const body = (await res.json()) as { result?: { tools?: Array<{ name: string }> } };
    const names = (body.result?.tools ?? []).map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'check_file_health',
        'get_active_sessions',
        'get_app_status',
        'get_db_stats',
        'get_recent_errors',
        'get_recent_posts',
        'list_users',
        'search_logs',
      ].sort(),
    );
  });
});

// ─── tools/call: runtime tools ────────────────────────────────────────────────

describeIf('tool: check_file_health', () => {
  test('summarizes repo file health with context hazards', async () => {
    const { status, text } = await callTool('check_file_health', { limit: 5 });
    expect(status).toBe(200);
    const body = JSON.parse(text) as {
      available: boolean;
      summary: { scanned: number };
      over: unknown[];
      contextHazards: Array<{ path: string; hazard: string; advice: string }>;
    };
    expect(body.available).toBe(true);
    expect(body.summary.scanned).toBeGreaterThan(20);
    expect(body.over.length).toBeLessThanOrEqual(5);
    expect(body.contextHazards.some((h) => h.path === 'bun.lock' && h.hazard === 'danger')).toBe(
      true,
    );
  });

  test('reports a single file with read advice', async () => {
    const { text } = await callTool('check_file_health', {
      path: 'server/mcp/tools/file-health.ts',
    });
    const body = JSON.parse(text) as { found: boolean; file: { kind: string; advice: string } };
    expect(body.found).toBe(true);
    expect(body.file.kind).toBe('route');
    expect(body.file.advice).toContain('Aman');
  });
});

describeIf('tool: get_app_status', () => {
  test('reports env, port and memory numbers', async () => {
    const { status, text } = await callTool('get_app_status');
    expect(status).toBe(200);
    const payload = JSON.parse(text) as {
      env: string;
      port: number;
      memory: { heapUsedMb: number };
    };
    expect(payload.env).toBe('test');
    expect(typeof payload.port).toBe('number');
    expect(typeof payload.memory.heapUsedMb).toBe('number');
  });
});

describeIf('tool: get_recent_errors / search_logs', () => {
  test('get_recent_errors surfaces the buffered sentinel', async () => {
    const { status, text } = await callTool('get_recent_errors', { limit: 200 });
    expect(status).toBe(200);
    expect(text).toContain(errorSentinel);
  });

  test('search_logs finds the sentinel by substring', async () => {
    const { text } = await callTool('search_logs', { query: errorSentinel });
    expect(text).toContain(errorSentinel);
  });

  test('search_logs reports no match for an absent query', async () => {
    const { text } = await callTool('search_logs', { query: `nope-${runId}-zzz` });
    expect(text.toLowerCase()).toContain('no entries matching');
  });
});

// ─── tools/call: database tools (read-only) ───────────────────────────────────

describeIf('tool: get_db_stats', () => {
  test('returns numeric row counts for core tables', async () => {
    const { status, text } = await callTool('get_db_stats');
    expect(status).toBe(200);
    const stats = JSON.parse(text) as Record<string, number>;
    expect(typeof stats.user).toBe('number');
    expect(stats.user).toBeGreaterThanOrEqual(1);
    expect(typeof stats.session).toBe('number');
    expect(typeof stats.post).toBe('number');
  });
});

describeIf('tool: list_users', () => {
  test('includes the seeded user and its role', async () => {
    const { text } = await callTool('list_users', { limit: 100 });
    const rows = JSON.parse(text) as Array<{ id: string; email: string; role: string }>;
    const row = rows.find((r) => r.id === seededUserId);
    expect(row).toBeDefined();
    expect(row?.email).toBe(seededEmail);
  });

  test('search filters by email substring', async () => {
    const { text } = await callTool('list_users', { search: runId });
    const rows = JSON.parse(text) as Array<{ id: string }>;
    expect(rows.some((r) => r.id === seededUserId)).toBe(true);
  });
});

describeIf('tool: get_active_sessions', () => {
  test('returns the non-expired session and excludes the expired one', async () => {
    const { text } = await callTool('get_active_sessions', { limit: 100 });
    const rows = JSON.parse(text) as Array<{ id: string }>;
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(activeSessionId);
    expect(ids).not.toContain(expiredSessionId);
  });
});

describeIf('tool: get_recent_posts', () => {
  test('includes the seeded post', async () => {
    const { text } = await callTool('get_recent_posts', { limit: 100 });
    const rows = JSON.parse(text) as Array<{ id: string; title: string }>;
    expect(rows.some((r) => r.id === seededPostId)).toBe(true);
  });
});
