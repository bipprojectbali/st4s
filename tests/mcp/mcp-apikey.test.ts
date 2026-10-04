/**
 * MCP endpoint accepts an API-key identity (set by apiKeyPlugin in onRequest
 * after verifying the `mcp` scope) and rejects anonymous calls with 401 —
 * regardless of whether the legacy MCP_ADMIN_TOKEN is configured.
 */
import { describe, expect, test } from 'bun:test';
import Elysia from 'elysia';
import { setApiKeyIdentity } from '../../server/api-keys/identity';
import { env } from '../../server/env';
import { mcpPlugin } from '../../server/mcp/index';

const app = new Elysia().use(mcpPlugin);
const INIT = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'key-client', version: '1.0' },
  },
};
const request = () =>
  new Request('http://localhost/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(INIT),
  });

describe('MCP auth via API key', () => {
  test('anonymous initialize is rejected', async () => {
    const res = await app.handle(request());
    expect(res.status).toBe(401);
  });
  test('without MCP_ADMIN_TOKEN the 401 tells the caller to use an mcp-scoped key', async () => {
    const saved = env.MCP_ADMIN_TOKEN;
    env.MCP_ADMIN_TOKEN = undefined;
    try {
      const res = await app.handle(request());
      expect(res.status).toBe(401);
      expect(await res.text()).toContain('API key ber-scope mcp');
    } finally {
      env.MCP_ADMIN_TOKEN = saved;
    }
  });
  test('a verified key identity opens a session', async () => {
    const req = request();
    setApiKeyIdentity(req, {
      keyId: 'key-1',
      keyName: 'agent-laptop',
      scopes: ['mcp'],
      user: { id: 'u1', email: 'u1@test.local', name: 'U1', role: 'super-admin' },
      role: 'super-admin',
      startedAt: performance.now(),
    });
    const res = await app.handle(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result?: { serverInfo?: { name: string } } };
    expect(body.result?.serverInfo?.name).toBe('st4s-debug');
    expect(res.headers.get('mcp-session-id')).toBeTruthy();
  });
});
