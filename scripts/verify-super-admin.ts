/**
 * Bootstrap a super-admin without Google: verify the email of an existing user
 * listed in SUPER_ADMIN_EMAILS. Prints only a masked email and the outcome.
 *
 *   bun scripts/verify-super-admin.ts owner@example.com
 *   bun run admin:verify owner@example.com
 */
import { superAdminEmails } from '../server/env';
import { maskEmail, type VerifyOutcome, verifySuperAdminEmail } from '../server/super-admin-bootstrap';

const MESSAGES: Record<VerifyOutcome, string> = {
  verified: 'Email ditandai terverifikasi. Masuk ulang untuk mendapat akses super-admin.',
  already_verified: 'Email sudah terverifikasi — tidak ada perubahan.',
  not_allowlisted: 'Ditolak: email tidak ada di SUPER_ADMIN_EMAILS. Tambahkan dulu lalu jalankan lagi.',
  user_not_found: 'Ditolak: belum ada user dengan email ini. Daftar dulu (sign-up) lalu jalankan lagi.',
};

const email = process.argv[2];
if (!email) {
  console.error('Pemakaian: bun scripts/verify-super-admin.ts <email>');
  process.exit(1);
}

try {
  const outcome = await verifySuperAdminEmail(email, superAdminEmails);
  const ok = outcome === 'verified' || outcome === 'already_verified';
  (ok ? console.log : console.error)(`${maskEmail(email)}: ${MESSAGES[outcome]}`);
  process.exit(ok ? 0 : 1);
} catch (err) {
  // Message only: a driver error object can carry connection details.
  const reason = err instanceof Error ? err.message : String(err);
  console.error(`${maskEmail(email)}: gagal memperbarui database — ${reason}`);
  process.exit(1);
}
