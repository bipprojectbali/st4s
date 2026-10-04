/**
 * Binary entrypoint (bun build --compile). The engine spawners re-exec this
 * binary with `--s4s-engine-child stt|tts`; that argv is checked first and runs
 * the child module instead of the server (child source files do not exist
 * inside the binary).
 *
 * Otherwise defaults NODE_ENV to production before any module initializes so
 * pino picks its sync multistream and the API hides internal error details. An
 * explicit NODE_ENV — from the real environment or a `.env` in the working
 * directory, which Bun auto-loads — is respected but flagged, because a
 * production binary running as "development" exposes error details and skips
 * file logging.
 */
import { engineChildKind } from './engines/child-argv';

const child = engineChildKind(process.argv);
if (child === 'stt') {
  (await import('./engines/stt/child')).runSttChild(process.argv[4]);
} else if (child === 'tts') {
  (await import('./engines/tts/child')).runTtsChild();
} else {
  process.env.NODE_ENV ??= 'production';
  if (process.env.NODE_ENV !== 'production') {
    console.warn(
      `[makuro] NODE_ENV=${process.env.NODE_ENV} — binary berjalan bukan dalam mode production (cek .env di direktori kerja).`,
    );
  }
  await import('./prod');
}
