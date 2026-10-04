/** Client for /api/ops used by /dev/tools. */

export type OpsStatus = {
  env: string;
  version: string;
  bun: string;
  standalone: boolean;
  uptimeSeconds: number;
  memory: { heapUsedMb: number; rssMb: number };
  dbLatencyMs: number;
  limiter: { trackedClients: number; enabled: boolean };
  logBuffer: { size: number; capacity: number };
};
export type McpInfo = {
  enabled: boolean;
  legacyTokenEnabled: boolean;
  endpoint: string;
  tools: Array<{ name: string; description: string; group: 'status' | 'logs' | 'db' | 'code' }>;
  auth: { header: string; scope: string; legacyQuery: string; legacyEnvVar: string };
};
/** Env var the MCP client expands into the API key (never write the key inline). */
export const MCP_KEY_ENV = 'ST4S_MCP_KEY';
export type ResetTarget = { key: string; label: string; description: string };

const BASE = '/api/ops';
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${url} gagal (${res.status})`);
  return res.json();
}
export const fetchOpsStatus = () => request<OpsStatus>(`${BASE}/status`);
export const fetchMcpInfo = () => request<McpInfo>(`${BASE}/mcp`);
export const fetchResetTargets = () => request<ResetTarget[]>(`${BASE}/reset-targets`);
export const runReset = (key: string) =>
  request<{ ok: true }>(`${BASE}/reset/${encodeURIComponent(key)}`, { method: 'POST' });

/** "3 hari 4 jam" style uptime. */
export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d} hari ${h} jam`;
  if (h > 0) return `${h} jam ${m} menit`;
  return `${m} menit`;
}

/** `.mcp.json` snippet for Claude Code / other MCP clients (API key via env, never inline). */
export function mcpConfigSnippet(endpoint: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        'st4s-debug': {
          type: 'http',
          url: endpoint,
          headers: { Authorization: `Bearer \${${MCP_KEY_ENV}}` },
        },
      },
    },
    null,
    2,
  );
}
