import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SCRIPT = path.join(import.meta.dir, '../../scripts/release/package.sh');
const HOST_OK = process.platform === 'darwin' && process.arch === 'arm64';

let work = '';

beforeEach(async () => {
  work = await mkdtemp(path.join(tmpdir(), 'st4s-package-'));
  await mkdir(path.join(work, 'ggml'), { recursive: true });
  await writeFile(path.join(work, 'LICENSE'), 'MIT\n');
  await writeFile(path.join(work, 'ggml/LICENSE'), 'MIT\n');
});

afterEach(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

// The flag check runs before the build lock and `bun run build:binary`, so these runs never build.
function run(env: Record<string, string>) {
  const p = Bun.spawnSync(['bash', SCRIPT], {
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return { code: p.exitCode, out: p.stdout.toString() + p.stderr.toString() };
}

async function cache(dir: string, lines: string[]) {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'CMakeCache.txt'), `${lines.join('\n')}\n`);
}

describe.skipIf(!HOST_OK)('scripts/release/package.sh libcrispasr check', () => {
  it('defaults to <CRISPASR_DIR>/build-reloc and prints the command that builds it', () => {
    const r = run({ CRISPASR_DIR: work });
    expect(r.code).toBe(1);
    expect(r.out).toContain(`no libcrispasr release build at ${work}/build-reloc`);
    expect(r.out).toContain(
      `CRISPASR_BUILD_DIR="${work}/build-reloc" bash scripts/crispasr/build.sh`,
    );
    expect(r.out).not.toContain('== build st4s');
  });

  it('refuses a build configured with AMR or Opus on', async () => {
    const build = path.join(work, 'build');
    await cache(build, ['CRISPASR_AMR:BOOL=ON', 'CRISPASR_OPUS:BOOL=ON']);
    const r = run({ CRISPASR_DIR: work, CRISPASR_BUILD_DIR: build });
    expect(r.code).toBe(1);
    expect(r.out).toContain('not configured with CRISPASR_AMR=OFF');
    expect(r.out).not.toContain('== build st4s');

    await cache(build, ['CRISPASR_AMR:BOOL=OFF', 'CRISPASR_OPUS:BOOL=ON']);
    expect(run({ CRISPASR_DIR: work, CRISPASR_BUILD_DIR: build }).out).toContain(
      'not configured with CRISPASR_OPUS=OFF',
    );
  });
});
