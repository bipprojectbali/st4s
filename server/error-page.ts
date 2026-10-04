/**
 * Dependency-free HTML error page for the cases React Router cannot render
 * anything at all (SSR handler threw, server boot-time failure). Same visual
 * language as the maintenance page; carries the request id so users can quote
 * it and operators can find the matching log line.
 */

export type ErrorPageInput = {
  status: number;
  requestId?: string;
  appName?: string;
  /** Override the catalog message (already user-safe). */
  message?: string;
};

const CATALOG: Record<number, { title: string; message: string }> = {
  404: {
    title: 'Halaman tidak ditemukan',
    message: 'Alamat yang Anda buka tidak ada atau sudah dipindahkan.',
  },
  500: {
    title: 'Terjadi kesalahan di server',
    message:
      'Kami sudah mencatatnya. Muat ulang halaman; bila terus terjadi, laporkan dengan kode di bawah.',
  },
  503: { title: 'Layanan sementara tidak tersedia', message: 'Coba lagi beberapa saat lagi.' },
};
const FALLBACK = { title: 'Terjadi kesalahan', message: 'Permintaan tidak bisa diproses.' };

export const escapeHtml = (v: string) =>
  v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

export function errorHtml({
  status,
  requestId,
  appName = 'st4s',
  message,
}: ErrorPageInput): string {
  const c = CATALOG[status] ?? FALLBACK;
  const app = escapeHtml(appName);
  const ref = requestId
    ? `<p class="ref">Kode referensi <code>${escapeHtml(requestId)}</code></p>`
    : '';
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(c.title)} — ${app}</title><meta name="robots" content="noindex"><style>
:root{color-scheme:light dark}body{margin:0;font-family:system-ui,sans-serif;background:#fff;color:#1a1a1a;display:grid;place-items:center;min-height:100vh;padding:24px}
@media(prefers-color-scheme:dark){body{background:#141414;color:#eee}p{color:#bbb!important}code{background:#2a2a2a!important}}
main{max-width:480px;text-align:center}.status{font-size:4rem;font-weight:800;letter-spacing:-.04em;line-height:1;margin:0 0 8px;opacity:.25}h1{font-size:1.4rem;margin:0 0 12px}p{color:#555;line-height:1.55;margin:0 0 10px}
code{background:#f1f1f1;padding:2px 6px;border-radius:6px;font-size:.9em}.ref{font-size:.85rem}
.actions{margin-top:20px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap}a{color:inherit;text-decoration:none;border:1px solid currentColor;border-radius:8px;padding:8px 14px;font-size:.95rem;opacity:.85}a:hover{opacity:1}
</style></head><body><main><p class="status">${status}</p><h1>${escapeHtml(c.title)}</h1><p>${escapeHtml(message ?? c.message)}</p>${ref}<div class="actions"><a href="javascript:location.reload()">Muat ulang</a><a href="/">Ke beranda</a></div></main></body></html>`;
}

export function errorResponse(input: ErrorPageInput): Response {
  return new Response(errorHtml(input), {
    status: input.status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      ...(input.requestId ? { 'x-request-id': input.requestId } : {}),
    },
  });
}
