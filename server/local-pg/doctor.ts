/** `st4s doctor` lines for the built-in Postgres: runtime + hash, data dir, PG_VERSION, owner. Read-only, never starts it. */
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { DoctorCheck } from '../cli/doctor';
import { liveOwner, OWNER_FILE, versionMismatch } from './claim';
import { PG_MAJOR, pgDataDir, pgRuntimeDir, pgRuntimeIsManual } from './paths';
import {
  ALLOW_UNVERIFIED_ENV,
  allowUnverified,
  detectPlatform,
  installedSha256,
  PG_ARTIFACTS,
  pgBin,
  resolvePlatform,
} from './runtime';
import { readOrNull } from './server';

type Env = Record<string, string | undefined>;

export async function localPgChecks(
  env: Env,
  host: ReturnType<typeof detectPlatform> = detectPlatform(),
): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [
    { name: 'DATABASE_URL', ok: true, required: true, detail: 'kosong — PostgreSQL bawaan' },
  ];
  const detected = resolvePlatform(env, host);
  if ('error' in detected) {
    checks.push({
      name: 'PostgreSQL bawaan',
      ok: false,
      required: true,
      detail: detected.error,
      fix: 'isi DATABASE_URL di .env',
    });
    return checks;
  }
  const override = `${ALLOW_UNVERIFIED_ENV}=${allowUnverified(env) ? '1 aktif' : 'tidak aktif'}`;
  checks.push({
    name: 'platform Postgres',
    ok: true,
    required: true,
    detail: PG_ARTIFACTS[detected.platform].verified
      ? `${detected.platform} (terverifikasi; ${override})`
      : `${detected.platform} (BELUM diverifikasi — staging; ${override})`,
  });
  const runtime = pgRuntimeDir(detected.platform, env);
  const artifact = PG_ARTIFACTS[detected.platform];
  const installFix = 'jalankan `st4s init` (mengunduh ±60 MB, atau set ST4S_PG_ARCHIVE)';
  if (pgRuntimeIsManual(env)) {
    const ok = existsSync(pgBin(runtime, 'postgres'));
    checks.push({
      name: 'runtime Postgres',
      ok,
      required: true,
      detail: ok ? `${runtime} (ST4S_PG_RUNTIME)` : `tidak ada bin/postgres di ${runtime}`,
      fix: 'perbaiki ST4S_PG_RUNTIME',
    });
  } else {
    const sha = await installedSha256(runtime);
    checks.push(
      sha === artifact.sha256
        ? {
            name: 'runtime Postgres',
            ok: true,
            required: true,
            detail: `${runtime} (sha256 ${sha.slice(0, 12)}… cocok)`,
          }
        : {
            name: 'runtime Postgres',
            ok: false,
            required: false,
            detail: sha ? 'sha256 tidak cocok' : `belum terpasang: ${runtime}`,
            fix: `${installFix}; server juga memasangnya saat start`,
          },
    );
  }

  const dataDir = pgDataDir(env);
  const dataMajor = readOrNull(path.join(dataDir, 'PG_VERSION'))?.trim();
  const mismatch = dataMajor ? versionMismatch(dataDir, dataMajor, PG_MAJOR) : null;
  const owner = liveOwner(readOrNull(path.join(dataDir, OWNER_FILE)));
  checks.push(
    !dataMajor
      ? {
          name: 'data Postgres',
          ok: false,
          required: false,
          detail: `belum dibuat: ${dataDir}`,
          fix: 'jalankan `st4s init`',
        }
      : mismatch
        ? { name: 'data Postgres', ok: false, required: true, detail: mismatch }
        : {
            name: 'data Postgres',
            ok: true,
            required: true,
            detail: `${dataDir} (PG ${dataMajor}, ${owner ? `dipakai ${owner.known ? 'st4s' : 'proses tak dikenal'} PID ${owner.pid}` : 'tidak sedang berjalan'})`,
          },
  );
  return checks;
}
