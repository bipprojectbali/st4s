/** Error page catalog (pure): maps whatever React Router hands the boundary to user-facing copy. */
import { isRouteErrorResponse } from 'react-router';

export type ErrorKind =
  | 'not-found'
  | 'forbidden'
  | 'unauthorized'
  | 'server'
  | 'unavailable'
  | 'other';

export type ErrorInfo = {
  status: number;
  kind: ErrorKind;
  title: string;
  description: string;
  /** Short next step shown under the description. */
  hint: string;
  /** Developer detail (message/stack) — only rendered in development. */
  detail: string | null;
};

const CATALOG: Record<ErrorKind, Omit<ErrorInfo, 'status' | 'detail'>> = {
  'not-found': {
    kind: 'not-found',
    title: 'Halaman tidak ditemukan',
    description: 'Alamat yang Anda buka tidak ada, sudah dipindahkan, atau salah ketik.',
    hint: 'Periksa kembali alamatnya atau kembali ke halaman sebelumnya.',
  },
  forbidden: {
    kind: 'forbidden',
    title: 'Akses ditolak',
    description: 'Akun Anda tidak punya izin untuk membuka halaman ini.',
    hint: 'Masuk dengan akun yang berhak, atau minta admin menaikkan role Anda.',
  },
  unauthorized: {
    kind: 'unauthorized',
    title: 'Perlu masuk',
    description: 'Sesi Anda sudah berakhir atau Anda belum masuk.',
    hint: 'Masuk lagi untuk melanjutkan.',
  },
  server: {
    kind: 'server',
    title: 'Terjadi kesalahan',
    description: 'Ada yang salah saat memuat halaman ini. Kesalahannya sudah kami catat.',
    hint: 'Muat ulang halaman. Bila terus terjadi, laporkan dengan kode referensi di bawah.',
  },
  unavailable: {
    kind: 'unavailable',
    title: 'Layanan sementara tidak tersedia',
    description: 'Server sedang sibuk atau dalam pemeliharaan.',
    hint: 'Coba lagi beberapa saat lagi.',
  },
  other: {
    kind: 'other',
    title: 'Permintaan tidak bisa diproses',
    description: 'Server menolak permintaan ini.',
    hint: 'Kembali ke halaman sebelumnya dan coba lagi.',
  },
};

export function kindForStatus(status: number): ErrorKind {
  if (status === 404) return 'not-found';
  if (status === 403) return 'forbidden';
  if (status === 401) return 'unauthorized';
  if (status === 503) return 'unavailable';
  if (status >= 500) return 'server';
  return 'other';
}

/** Normalize a thrown Response, Error, or unknown value into page copy. */
export function describeError(error: unknown, dev = false): ErrorInfo {
  if (isRouteErrorResponse(error)) {
    const status = error.status;
    const kind = kindForStatus(status);
    const fromServer = typeof error.data === 'string' && error.data.trim() ? error.data : null;
    return {
      ...CATALOG[kind],
      status,
      description: kind === 'other' && fromServer ? fromServer : CATALOG[kind].description,
      detail: dev ? fromServer || error.statusText || null : null,
    };
  }
  const detail =
    error instanceof Error ? `${error.message}${error.stack ? `\n${error.stack}` : ''}` : null;
  return { ...CATALOG.server, status: 500, detail: dev ? detail : null };
}

/** Short, human-quotable reference for support ("ERR-3F9K2A"). */
export function errorReference(now = Date.now()): string {
  return `ERR-${now.toString(36).toUpperCase().slice(-6)}`;
}

export const ERROR_TITLE_SUFFIX = ' — st4s';
