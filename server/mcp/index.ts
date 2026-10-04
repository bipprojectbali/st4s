import { mcp } from 'elysia-mcp';
import { getApiKeyIdentity } from '../api-keys/identity';
import { env } from '../env';
import { registerAppStatusTool } from './tools/app-status';
import { registerDbTools } from './tools/db';
import { registerFileHealthTool } from './tools/file-health';
import { registerLogTools } from './tools/logs';

/** Extracts the MCP admin token from either Bearer header or ?mcpAdminToken query param. */
function resolveToken(request: Request): string | null {
  const bearer = request.headers.get('Authorization');
  if (bearer?.startsWith('Bearer ')) return bearer.slice(7);
  try {
    return new URL(request.url).searchParams.get('mcpAdminToken');
  } catch {
    return null;
  }
}

export const mcpPlugin = mcp({
  serverInfo: { name: 'st4s-debug', version: '1.0.0' },
  capabilities: { tools: {} },
  // Reply to each POST with a plain application/json body instead of an SSE
  // stream. The MCP Streamable HTTP spec makes SSE optional for single
  // request/response calls, and elysia-mcp 0.1.1's SSE writer double-prefixes
  // frames (`data: event: message`), which spec-compliant clients cannot parse.
  enableJsonResponse: true,
  authentication: async (ctx) => {
    // Preferred: an API key with the `mcp` scope (verified by apiKeyPlugin in
    // onRequest, which also records usage per key). Never the key itself in AuthInfo.
    const key = getApiKeyIdentity(ctx.request);
    if (key)
      return {
        authInfo: { token: key.keyId, clientId: key.keyName ?? key.keyId, scopes: ['mcp'] },
      };
    // Legacy: shared MCP_ADMIN_TOKEN from env (bearer or query param).
    if (!env.MCP_ADMIN_TOKEN) {
      return {
        response: new Response(
          'Unauthorized: kirim API key ber-scope mcp (Authorization: Bearer mk_live_…)',
          {
            status: 401,
          },
        ),
      };
    }
    const token = resolveToken(ctx.request);
    if (!token || token !== env.MCP_ADMIN_TOKEN) {
      return { response: new Response('Unauthorized', { status: 401 }) };
    }
    // AuthInfo requires token + clientId + scopes per MCP SDK.
    return { authInfo: { token, clientId: 'st4s-debug', scopes: [] } };
  },
  setupServer: async (server) => {
    registerAppStatusTool(server);
    registerLogTools(server);
    registerDbTools(server);
    registerFileHealthTool(server);
  },
});
