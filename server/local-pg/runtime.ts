/** Fetch, verify (sha256 before extracting) and install the pinned zonky Postgres runtime. No npm deps: zip via DecompressionStream, xz via system `tar`. */
import { existsSync, readdirSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PG_RELEASE, pgRuntimeDir, pgRuntimeIsManual } from './paths';

type Env = Record<string, string | undefined>;
export type PgPlatform = 'darwin-arm64' | 'darwin-x64' | 'linux-x64' | 'linux-arm64';
/** `verified` = actually booted by st4s tests; the others are pinned from Maven Central but UNVERIFIED. */
export type PgArtifact = { zonky: string; sha256: string; size: number; verified: boolean };

/** Maven Central sha256 of `embedded-postgres-binaries-<zonky>-17.11.0.jar` (checked against the downloaded files). */
export const PG_ARTIFACTS: Record<PgPlatform, PgArtifact> = {
  'darwin-arm64': {
    zonky: 'darwin-arm64v8',
    sha256: 'a1c2786acb0c398f9b2d76806fc52f5dc8b222cbc8e9383a9b9702084daaf3a5',
    size: 62141006,
    verified: true,
  },
  'darwin-x64': {
    zonky: 'darwin-amd64',
    sha256: 'd464ff178e9860ba204662ac23fa547504b7fd392392ff2fb92e3fd73b5bdb64',
    size: 62141006,
    verified: false,
  },
  'linux-x64': {
    zonky: 'linux-amd64',
    sha256: '0dd7b72b6f335b8ecfb355fa24c5781e8a93edd09880bb77eb52ebbf29b3e96d',
    size: 14987378,
    verified: true,
  },
  'linux-arm64': {
    zonky: 'linux-arm64v8',
    sha256: '8b042e0ea418b1927d95399207950da0734d27fe01e29503ade3bdc464ad4c2b',
    size: 14015430,
    verified: true,
  },
};

const MAVEN = 'https://repo1.maven.org/maven2/io/zonky/test/postgres';
const MARKER = '.ok';
const USE_URL = 'set DATABASE_URL ke PostgreSQL ≥ 17 yang sudah ada';

export const artifactUrl = (a: PgArtifact) =>
  `${MAVEN}/embedded-postgres-binaries-${a.zonky}/${PG_RELEASE}/embedded-postgres-binaries-${a.zonky}-${PG_RELEASE}.jar`;

const isMusl = () => {
  try {
    return readdirSync('/lib').some((f) => f.startsWith('ld-musl-'));
  } catch {
    return false; // no /lib at all (macOS) → not musl
  }
};

/** Host platform key, or an error message telling the user to use DATABASE_URL. */
export function detectPlatform(
  host: { platform: string; arch: string; musl: boolean } = {
    platform: process.platform,
    arch: process.arch,
    musl: process.platform === 'linux' && isMusl(),
  },
): { platform: PgPlatform } | { error: string } {
  const key = `${host.platform}-${host.arch}`;
  if (host.musl)
    return { error: `Postgres bawaan tidak tersedia untuk Linux musl (Alpine) — ${USE_URL}.` };
  if (key in PG_ARTIFACTS) return { platform: key as PgPlatform };
  return { error: `Postgres bawaan tidak tersedia untuk ${key} — ${USE_URL}.` };
}

export const ALLOW_UNVERIFIED_ENV = 'ST4S_PG_ALLOW_UNVERIFIED';
export const allowUnverified = (env: Env) => env[ALLOW_UNVERIFIED_ENV]?.trim() === '1';

/**
 * Platform gate for built-in mode: unverified platforms are refused unless ST4S_PG_ALLOW_UNVERIFIED=1,
 * which proceeds with a warning. Unsupported hosts (musl, win32, …) stay refused regardless.
 */
export function resolvePlatform(
  env: Env,
  detected: ReturnType<typeof detectPlatform> = detectPlatform(),
): { platform: PgPlatform; warning?: string } | { error: string } {
  if ('error' in detected) return detected;
  const p = detected.platform;
  if (PG_ARTIFACTS[p].verified) return { platform: p };
  if (allowUnverified(env))
    return {
      platform: p,
      warning: `PERINGATAN: Postgres bawaan belum diverifikasi di ${p} — dilanjutkan karena ${ALLOW_UNVERIFIED_ENV}=1 (staging).`,
    };
  return {
    error: `Postgres bawaan belum diverifikasi di ${p}. Isi DATABASE_URL, atau set ${ALLOW_UNVERIFIED_ENV}=1 untuk mencoba (staging).`,
  };
}

export const pgBin = (dir: string, name: 'initdb' | 'pg_ctl' | 'postgres') =>
  path.join(dir, 'bin', name);

/** sha256 recorded by a finished install (marker is written last), or null. */
export async function installedSha256(dir: string): Promise<string | null> {
  const marker = Bun.file(path.join(dir, MARKER));
  if (!(await marker.exists()) || !existsSync(pgBin(dir, 'postgres'))) return null;
  return (await marker.text()).trim();
}

export async function sha256File(file: string): Promise<string> {
  const hasher = new Bun.CryptoHasher('sha256');
  for await (const chunk of Bun.file(file).stream()) hasher.update(chunk);
  return hasher.digest('hex');
}

/** Locate the single `.txz` entry of a jar via its central directory (no zip64; jars are ~60 MB). */
export async function findTxzEntry(
  jar: string,
): Promise<{ start: number; size: number; deflated: boolean }> {
  const file = Bun.file(jar);
  const tailStart = Math.max(0, file.size - 65_557);
  const tail = new DataView(await file.slice(tailStart).arrayBuffer());
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--)
    if (tail.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error(`${jar} bukan arsip zip/jar`);
  const cdSize = tail.getUint32(eocd + 12, true);
  const cdOff = tail.getUint32(eocd + 16, true);
  const cd = new DataView(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
  for (let p = 0; p + 46 <= cd.byteLength && cd.getUint32(p, true) === 0x02014b50; ) {
    const nameLen = cd.getUint16(p + 28, true);
    const name = new TextDecoder().decode(new Uint8Array(cd.buffer, p + 46, nameLen));
    if (name.endsWith('.txz')) {
      const method = cd.getUint16(p + 10, true);
      const size = cd.getUint32(p + 20, true);
      const local = cd.getUint32(p + 42, true);
      const lh = new DataView(await file.slice(local, local + 30).arrayBuffer());
      const start = local + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
      if (method !== 0 && method !== 8) throw new Error(`${name}: metode kompresi zip ${method}`);
      return { start, size, deflated: method === 8 };
    }
    p += 46 + nameLen + cd.getUint16(p + 30, true) + cd.getUint16(p + 32, true);
  }
  throw new Error(`${jar} tidak berisi postgres-*.txz`);
}

async function extractJar(jar: string, dest: string): Promise<void> {
  const e = await findTxzEntry(jar);
  const raw = Bun.file(jar)
    .slice(e.start, e.start + e.size)
    .stream();
  const txz = e.deflated ? raw.pipeThrough(new DecompressionStream('deflate-raw')) : raw;
  const tar = Bun.spawn(['tar', '-xJf', '-', '-C', dest], {
    stdin: txz,
    stdout: 'ignore',
    stderr: 'pipe',
  });
  const [code, stderr] = await Promise.all([tar.exited, new Response(tar.stderr).text()]);
  if (code !== 0)
    throw new Error(
      `Gagal mengekstrak runtime Postgres (tar exit ${code}): ${stderr.trim()} — tar harus mendukung xz (Linux: pasang xz-utils).`,
    );
}

async function download(url: string, dest: string, progress: (m: string) => void) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const out = Bun.file(dest).writer();
  let done = 0;
  let shown = 0;
  for await (const chunk of res.body) {
    out.write(chunk);
    done += chunk.byteLength;
    const pct = total ? Math.floor((done / total) * 10) * 10 : 0;
    if (pct > shown) {
      shown = pct;
      progress(`  ${pct}% (${Math.round(done / 1e6)} MB)`);
    }
  }
  await out.end();
}

export type EnsureRuntimeOptions = {
  env?: Env;
  platform?: PgPlatform;
  /** Test seam: replaces the pinned artifact (url is still derived from it). */
  artifact?: PgArtifact;
  onProgress?: (msg: string) => void;
};

/**
 * Return a runtime dir holding bin/postgres, installing it when missing: jar from `$ST4S_PG_ARCHIVE`
 * (offline) or Maven Central → sha256 check → extract into a staging dir → atomic rename → `.ok` marker.
 */
export async function ensureRuntime(opts: EnsureRuntimeOptions = {}): Promise<string> {
  const env = opts.env ?? process.env;
  const detected = resolvePlatform(
    env,
    opts.platform ? { platform: opts.platform } : detectPlatform(),
  );
  if ('error' in detected) throw new Error(detected.error);
  const progress = opts.onProgress ?? ((m: string) => console.error(`[st4s] ${m}`));
  if (detected.warning) progress(detected.warning);
  const dir = pgRuntimeDir(detected.platform, env);
  if (pgRuntimeIsManual(env)) {
    if (existsSync(pgBin(dir, 'postgres'))) return dir;
    throw new Error(`ST4S_PG_RUNTIME=${dir} tidak berisi bin/postgres.`);
  }
  const artifact = opts.artifact ?? PG_ARTIFACTS[detected.platform];
  if ((await installedSha256(dir)) === artifact.sha256) return dir;

  await fs.mkdir(path.dirname(dir), { recursive: true });
  const stage = `${dir}.tmp-${process.pid}`;
  const tmpJar = `${stage}.jar`;
  try {
    let jar = env.ST4S_PG_ARCHIVE?.trim();
    if (!jar) {
      const url = artifactUrl(artifact);
      progress(
        `Mengunduh Postgres ${PG_RELEASE} (${Math.round(artifact.size / 1e6)} MB) dari ${url}`,
      );
      await download(url, tmpJar, progress).catch((e: Error) => {
        throw new Error(
          `Gagal mengunduh runtime Postgres (${e.message}) dari ${url}. Offline: unduh jar itu di mesin lain lalu set ST4S_PG_ARCHIVE=<path jar>, atau ${USE_URL}.`,
        );
      });
      jar = tmpJar;
    }
    const actual = await sha256File(jar);
    if (actual !== artifact.sha256)
      throw new Error(
        `Checksum runtime Postgres tidak cocok (${jar}): diharapkan sha256 ${artifact.sha256}, didapat ${actual}. Arsip ditolak.`,
      );
    progress(`Mengekstrak runtime Postgres ke ${dir}`);
    await fs.rm(stage, { recursive: true, force: true });
    await fs.mkdir(stage, { recursive: true });
    await extractJar(jar, stage);
    if (!existsSync(pgBin(stage, 'postgres')))
      throw new Error(`Arsip ${jar} tidak berisi bin/postgres.`);
    // A dir without a matching marker is a partial/older install: replace it whole.
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rename(stage, dir);
    await Bun.write(path.join(dir, MARKER), `${artifact.sha256}\n`);
    return dir;
  } finally {
    await fs.rm(tmpJar, { force: true });
    await fs.rm(stage, { recursive: true, force: true });
  }
}
