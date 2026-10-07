/** `st4s doctor`: install checklist with a fix hint per failing line. Works without any .env; never prints values. */
import { dlopen, FFIType } from 'bun:ffi';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSttConfig } from '../engines/stt/config';
import { ttsModelDir } from '../engines/tts/config';
import { ortLibPath } from '../engines/tts/ort-preload';
import { localPgChecks } from '../local-pg/doctor';
import { st4sHome, st4sLibDir } from '../st4s-home';
import { type MigrationState, migrationState } from './migrate';

type Env = Record<string, string | undefined>;
export type DoctorCheck = {
  name: string;
  ok: boolean;
  required: boolean;
  detail: string;
  fix?: string;
};
type RunResult = { exitCode: number; stdout: string };

/** Injection points for tests; defaults hit the real system. */
export type DoctorProbe = {
  env?: Env;
  platform?: NodeJS.Platform;
  run?: (cmd: string[]) => RunResult;
  dbState?: (url: string) => Promise<MigrationState>;
  /** Throws when the library cannot be loaded. */
  loadLib?: (file: string) => void;
  freePct?: () => number;
};

const MIN_FREE_PCT = 25;
const QUARANTINE = ': com.apple.quarantine:';

function runCmd(cmd: string[]): RunResult {
  try {
    const r = Bun.spawnSync(cmd, { stdout: 'pipe', stderr: 'pipe' });
    return { exitCode: r.exitCode ?? 1, stdout: r.stdout.toString() };
  } catch (e) {
    return { exitCode: 127, stdout: (e as Error).message };
  }
}

function loadCrispasr(file: string): void {
  dlopen(file, { crispasr_session_close: { args: [FFIType.ptr], returns: FFIType.void } }).close();
}

/** Available RAM %: macOS memorystatus level, Linux MemAvailable, else os.freemem. */
function freePct(): number {
  if (process.platform === 'darwin') {
    const n = Number(runCmd(['sysctl', '-n', 'kern.memorystatus_level']).stdout.trim());
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (process.platform === 'linux') {
    const kb = /MemAvailable:\s+(\d+)/.exec(readFileSync('/proc/meminfo', 'utf8'))?.[1];
    if (kb) return Math.round(((Number(kb) * 1024) / os.totalmem()) * 100);
  }
  return Math.round((os.freemem() / os.totalmem()) * 100);
}

/** Files under `dir` carrying `com.apple.quarantine` (read via `xattr`, nothing is executed). */
export function quarantinedPaths(
  dir: string,
  run: (cmd: string[]) => RunResult = runCmd,
): string[] {
  if (!existsSync(dir)) return [];
  return run(['xattr', '-rl', dir])
    .stdout.split('\n')
    .filter((l) => l.includes(QUARANTINE))
    .map((l) => l.slice(0, l.lastIndexOf(QUARANTINE)));
}

const fileCheck = (name: string, file: string, fix: string): DoctorCheck =>
  existsSync(file)
    ? { name, ok: true, required: true, detail: file }
    : { name, ok: false, required: true, detail: `tidak ditemukan: ${file}`, fix };

/** Run every check; the caller prints them. */
export async function doctorChecks(probe: DoctorProbe = {}): Promise<DoctorCheck[]> {
  const env = probe.env ?? process.env;
  const run = probe.run ?? runCmd;
  const platform = probe.platform ?? process.platform;
  const checks: DoctorCheck[] = [];
  const add = (c: DoctorCheck) => checks.push(c);
  const home = st4sHome(env);

  // No home only happens from source (`bun run st4s doctor`): the repo .env and ./data are used.
  add(
    !home
      ? {
          name: 'folder st4s',
          ok: true,
          required: false,
          detail: 'dev (tanpa ST4S_HOME): .env folder repo, data di ./data',
        }
      : existsSync(home)
        ? { name: 'folder st4s', ok: true, required: true, detail: home }
        : {
            name: 'folder st4s',
            ok: false,
            required: true,
            detail: `tidak ditemukan: ${home}`,
            fix: 'jalankan `st4s init`',
          },
  );
  if (home) add(fileCheck('.env', path.join(home, '.env'), 'jalankan `st4s init`'));
  const localPg = !env.DATABASE_URL?.trim();
  if (localPg) for (const c of await localPgChecks(env)) add(c);
  for (const key of localPg ? ['BETTER_AUTH_SECRET'] : ['DATABASE_URL', 'BETTER_AUTH_SECRET'])
    add(
      env[key]?.trim()
        ? { name: key, ok: true, required: true, detail: 'terisi' }
        : { name: key, ok: false, required: true, detail: 'kosong', fix: `isi ${key} di .env` },
    );
  add(
    env.SUPER_ADMIN_EMAILS?.trim()
      ? { name: 'SUPER_ADMIN_EMAILS', ok: true, required: false, detail: 'terisi' }
      : {
          name: 'SUPER_ADMIN_EMAILS',
          ok: false,
          required: false,
          detail: 'kosong — belum ada super-admin',
          fix: 'isi SUPER_ADMIN_EMAILS di .env',
        },
  );

  const url = env.DATABASE_URL?.trim();
  if (url) {
    try {
      const s = await (probe.dbState ?? migrationState)(url);
      add(
        s.pending === 0
          ? {
              name: 'database',
              ok: true,
              required: true,
              detail: `terhubung, ${s.total} migrasi diterapkan`,
            }
          : {
              name: 'database',
              ok: false,
              required: true,
              detail: `${s.pending} migrasi tertunda`,
              fix: 'jalankan `st4s migrate`',
            },
      );
    } catch (e) {
      add({
        name: 'database',
        ok: false,
        required: true,
        detail: `tidak bisa dihubungi: ${(e as Error).message}`,
        fix: 'pastikan PostgreSQL jalan dan DATABASE_URL benar',
      });
    }
  }

  const quarantined = platform === 'darwin' && home ? quarantinedPaths(home, run) : [];
  if (platform === 'darwin')
    add(
      quarantined.length === 0
        ? { name: 'karantina macOS', ok: true, required: true, detail: 'tidak ada' }
        : {
            name: 'karantina macOS',
            ok: false,
            required: true,
            detail: `${quarantined.length} file, mis. ${quarantined[0]}`,
            fix: `xattr -dr com.apple.quarantine ${home}`,
          },
    );

  const libFix = 'pasang ulang bundle st4s (sh install.sh)';
  const stt = loadSttConfig(env);
  const crispasr = fileCheck('libcrispasr', stt.libPath, libFix);
  if (crispasr.ok) {
    const libQuarantined =
      platform === 'darwin' &&
      (quarantined.length > 0 || quarantinedPaths(path.dirname(stt.libPath), run).length > 0);
    if (libQuarantined) {
      crispasr.ok = false;
      crispasr.detail = 'tidak dimuat: file berkarantina';
      crispasr.fix = `xattr -dr com.apple.quarantine ${path.dirname(stt.libPath)}`;
    } else {
      try {
        (probe.loadLib ?? loadCrispasr)(stt.libPath);
        crispasr.detail = `${stt.libPath} (dlopen OK)`;
      } catch (e) {
        crispasr.ok = false;
        crispasr.detail = `dlopen gagal: ${(e as Error).message}`;
        crispasr.fix = libFix;
      }
    }
  }
  add(crispasr);
  const ort = ortLibPath(st4sLibDir(env), platform);
  if (ort) add(fileCheck('libonnxruntime', ort, libFix));

  const modelFix = 'jalankan `st4s models pull` (atau `st4s models import <folder>`)';
  add(fileCheck('model STT', stt.modelPath, modelFix));
  if (stt.vadModelPath) add(fileCheck('model VAD', stt.vadModelPath, modelFix));
  add(fileCheck('model LID', stt.lidModelPath, modelFix));
  const ttsDir = ttsModelDir(env);
  for (const sub of ['onnx', 'voice_styles'])
    add(fileCheck(`model TTS ${sub}/`, path.join(ttsDir, sub), modelFix));

  const ffmpeg = env.FFMPEG_PATH || 'ffmpeg';
  add(
    run([ffmpeg, '-version']).exitCode === 0
      ? { name: 'ffmpeg', ok: true, required: true, detail: ffmpeg }
      : {
          name: 'ffmpeg',
          ok: false,
          required: true,
          detail: `tidak bisa dijalankan: ${ffmpeg}`,
          fix: 'pasang ffmpeg (brew install ffmpeg / apt install ffmpeg) atau set FFMPEG_PATH',
        },
  );

  const pct = (probe.freePct ?? freePct)();
  add({
    name: 'RAM bebas',
    ok: pct >= MIN_FREE_PCT,
    required: false,
    detail: `${pct}%`,
    fix: `tutup aplikasi lain; engine butuh ≥ ${MIN_FREE_PCT}% bebas agar nyaman`,
  });
  return checks;
}

/** Print the checklist; exit 1 when any required check fails. */
export async function runDoctor(probe: DoctorProbe = {}): Promise<number> {
  const checks = await doctorChecks(probe);
  for (const c of checks) {
    console.log(`${c.ok ? '✅' : c.required ? '❌' : '⚠️ '} ${c.name.padEnd(20)} ${c.detail}`);
    if (!c.ok && c.fix) console.log(`   → ${c.fix}`);
  }
  const failed = checks.filter((c) => !c.ok && c.required).length;
  console.log(failed ? `\n${failed} pemeriksaan wajib gagal.` : '\nSemua pemeriksaan wajib lulus.');
  return failed ? 1 : 0;
}
