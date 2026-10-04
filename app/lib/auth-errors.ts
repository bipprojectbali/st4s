/**
 * Human copy for Better Auth error codes (sign-in/sign-up responses and the
 * `?error=` query the OAuth callback redirects to). Pure — unit-tested.
 */

export type AuthNotice = {
  kind: 'banned' | 'session' | 'error' | 'info';
  title: string;
  message: string;
};

const BANNED: AuthNotice = {
  kind: 'banned',
  title: 'Akun ini diblokir',
  message:
    'Anda tidak bisa masuk saat ini. Bila menurut Anda ini keliru, hubungi dukungan dengan menyebutkan email akun Anda.',
};

const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'Email atau kata sandi salah.',
  INVALID_PASSWORD: 'Kata sandi salah.',
  USER_NOT_FOUND: 'Akun dengan email itu tidak ditemukan.',
  EMAIL_NOT_VERIFIED: 'Email belum diverifikasi. Cek kotak masuk Anda.',
  USER_ALREADY_EXISTS: 'Email sudah terdaftar. Silakan masuk.',
  PASSWORD_TOO_SHORT: 'Kata sandi terlalu pendek.',
  PASSWORD_TOO_LONG: 'Kata sandi terlalu panjang.',
  INVALID_EMAIL: 'Format email tidak valid.',
  EMAIL_CAN_NOT_BE_UPDATED: 'Email tidak bisa diubah.',
  CREDENTIAL_ACCOUNT_NOT_FOUND: 'Akun ini masuk lewat Google. Gunakan tombol Google.',
  FAILED_TO_CREATE_USER: 'Pendaftaran gagal. Coba lagi.',
  INVALID_ORIGIN:
    'Asal permintaan tidak dikenali. Buka aplikasi lewat alamat resminya lalu coba lagi.',
  // OAuth callback (`?error=` in lowercase snake case)
  unable_to_create_user: 'Gagal membuat akun lewat Google. Coba lagi.',
  signup_disabled:
    'Pendaftaran akun baru sedang ditutup. Hubungi administrator untuk mendapatkan akses.',
  account_not_linked:
    'Email ini sudah terdaftar dengan kata sandi. Masuk dengan email dan kata sandi Anda.',
  unable_to_get_user_info: 'Google tidak mengirim data akun. Coba lagi.',
  unable_to_link_account: 'Akun Google ini tidak bisa ditautkan.',
  email_not_found: 'Google tidak memberikan alamat email.',
  access_denied: 'Anda membatalkan masuk dengan Google.',
  state_mismatch: 'Sesi masuk kedaluwarsa. Coba lagi.',
  please_restart_the_process: 'Sesi masuk kedaluwarsa. Coba lagi.',
};

const SESSION_ENDED: AuthNotice = {
  kind: 'session',
  title: 'Sesi Anda sudah berakhir',
  message:
    'Anda dikeluarkan karena sesi kedaluwarsa, dicabut, atau akun tidak lagi tersedia. Masuk lagi untuk melanjutkan.',
};

/** Map a Better Auth error (or bare code) to a notice; unknown codes fall back to the raw message. */
export function describeAuthError(
  err: { code?: string | null; message?: string | null } | string | null | undefined,
): AuthNotice {
  const code = (typeof err === 'string' ? err : err?.code) ?? '';
  if (code.toUpperCase() === 'BANNED_USER') return BANNED;
  const message =
    MESSAGES[code] ??
    MESSAGES[code.toUpperCase()] ??
    (typeof err === 'object' && err?.message ? err.message : 'Autentikasi gagal. Coba lagi.');
  return { kind: 'error', title: 'Tidak bisa masuk', message };
}

/** Notice for the login page from its URL: `?notice=session` (guard) or `?error=<code>` (OAuth). */
export function loginNotice(params: URLSearchParams): AuthNotice | null {
  const error = params.get('error');
  if (error) return describeAuthError(error);
  if (params.get('notice') === 'session') return SESSION_ENDED;
  return null;
}
