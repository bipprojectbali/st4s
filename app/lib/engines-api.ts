/** Client for /api/engines used by /dev/engines and /dev/playground. */
import type { EngineOverview } from '@server/api/engines';
import type { EngineState, EngineStatus } from '@server/engines/types';

export type { EngineOverview, EngineStatus };
export type EngineKind = 'stt' | 'tts';
export type EngineAction = 'warmup' | 'unload';

const BASE = '/api/engines';

/** Error message from a JSON body — `{ error: string }` (/api) or `{ error: { message } }` (/api/v1). */
export async function apiErrorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as {
    error?: string | { message?: string };
  } | null;
  const err = body?.error;
  const msg = typeof err === 'string' ? err : err?.message;
  return msg ? `${msg} (${res.status})` : `${fallback} (${res.status})`;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(await apiErrorMessage(res, `${init?.method ?? 'GET'} ${url} gagal`));
  return res.json();
}

export const fetchEngines = () => request<EngineOverview>(BASE);
export const runEngineAction = (kind: EngineKind, action: EngineAction) =>
  request<{ ok: true; ms: number; status: EngineStatus | null }>(`${BASE}/${kind}/${action}`, {
    method: 'POST',
  });

export const STATE_META: Record<EngineState, { label: string; color: string }> = {
  unloaded: { label: 'Belum dimuat', color: 'gray' },
  loading: { label: 'Memuat', color: 'blue' },
  ready: { label: 'Siap', color: 'teal' },
  busy: { label: 'Sibuk', color: 'yellow' },
  error: { label: 'Error', color: 'red' },
};

/** "1,2 GB" / "340 MB"; dash for unknown. */
export function formatBytes(n: number | null | undefined): string {
  if (n == null) return '—';
  const nf = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });
  if (n >= 1024 ** 3) return `${nf.format(n / 1024 ** 3)} GB`;
  return `${nf.format(n / 1024 ** 2)} MB`;
}

/** "850 ms" / "2,4 dtk"; dash for unknown. */
export function formatMs(ms: number | null | undefined): string {
  if (ms == null) return '—';
  const nf = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });
  return ms < 1000 ? `${Math.round(ms)} ms` : `${nf.format(ms / 1000)} dtk`;
}
