import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SCRIPT = path.join(import.meta.dir, '../../scripts/install.sh');
const ARCH = process.arch === 'arm64' ? 'arm64' : 'x64';
const HOST = `${process.platform === 'darwin' ? 'darwin' : 'linux'}-${ARCH}`;
const QUARANTINE = 'com.apple.quarantine';

let work = '';
let home = '';

beforeEach(async () => {
  work = await mkdtemp(path.join(tmpdir(), 'st4s-install-'));
  home = path.join(work, 'home');
});

afterEach(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

function run(cmd: string[], env: Record<string, string> = {}) {
  const p = Bun.spawnSync(cmd, { env: { ...process.env, ...env }, stdout: 'pipe', stderr: 'pipe' });
  return { code: p.exitCode, out: p.stdout.toString() + p.stderr.toString() };
}

// Fake release (test-only): the dummy binary is never executed; lib file is plain text.
async function fakeTarball(
  opts: { platform?: string; version?: string; quarantineLib?: boolean } = {},
) {
  const src = path.join(work, `src-${crypto.randomUUID()}`);
  const root = path.join(src, 'st4s');
  await mkdir(path.join(root, 'lib'), { recursive: true });
  await mkdir(path.join(root, 'LICENSES'), { recursive: true });
  await writeFile(path.join(root, 'st4s'), `#!/bin/sh\necho ${opts.version ?? '9.9.9'}\n`);
  await chmod(path.join(root, 'st4s'), 0o755);
  await writeFile(path.join(root, 'lib/libfake.dylib'), 'not a real library\n');
  await writeFile(path.join(root, 'LICENSES/st4s.txt'), 'MIT\n');
  await writeFile(path.join(root, 'README.txt'), 'readme\n');
  await writeFile(
    path.join(root, 'BUILD_INFO'),
    `version=${opts.version ?? '9.9.9'}\nplatform=${opts.platform ?? HOST}\n`,
  );
  if (opts.quarantineLib) {
    const q = run([
      'xattr',
      '-w',
      QUARANTINE,
      '0083;00000000;Safari;',
      path.join(root, 'lib/libfake.dylib'),
    ]);
    expect(q.code).toBe(0);
  }
  const tarball = path.join(
    work,
    `st4s-${opts.version ?? '9.9.9'}-${HOST}-${crypto.randomUUID()}.tar.gz`,
  );
  expect(run(['tar', '-C', src, '-czf', tarball, 'st4s']).code).toBe(0);
  return tarball;
}

const install = (tarball: string) => run(['sh', SCRIPT, tarball], { ST4S_HOME: home });

describe('scripts/install.sh', () => {
  it('installs binary, lib/, LICENSES and prints next steps', async () => {
    const r = install(await fakeTarball());
    expect(r.code).toBe(0);
    expect(await readFile(path.join(home, 'st4s'), 'utf8')).toContain('9.9.9');
    expect(await Bun.file(path.join(home, 'lib/libfake.dylib')).exists()).toBe(true);
    expect(await Bun.file(path.join(home, 'LICENSES/st4s.txt')).exists()).toBe(true);
    expect(r.out).toContain(`${home}/st4s init`);
    expect(r.out).toContain('models pull');
    const leftovers = run(['sh', '-c', `ls -A "${home}"`]).out.split('\n');
    expect(leftovers.some((f) => f.startsWith('.install.'))).toBe(false);
  });

  it('upgrades in place without touching .env, models/ or logs/', async () => {
    await mkdir(path.join(home, 'models/stt'), { recursive: true });
    await mkdir(path.join(home, 'logs'), { recursive: true });
    await mkdir(path.join(home, 'lib'), { recursive: true });
    await writeFile(path.join(home, '.env'), 'DATABASE_URL=keep-me\n');
    await writeFile(path.join(home, 'models/stt/model.gguf'), 'weights');
    await writeFile(path.join(home, 'logs/app.log'), 'old log');
    await writeFile(path.join(home, 'lib/libold.dylib'), 'stale');
    await writeFile(path.join(home, 'st4s'), 'old binary');

    const r = install(await fakeTarball({ version: '2.0.0' }));
    expect(r.code).toBe(0);
    expect(await readFile(path.join(home, '.env'), 'utf8')).toBe('DATABASE_URL=keep-me\n');
    expect(await readFile(path.join(home, 'models/stt/model.gguf'), 'utf8')).toBe('weights');
    expect(await readFile(path.join(home, 'logs/app.log'), 'utf8')).toBe('old log');
    expect(await readFile(path.join(home, 'st4s'), 'utf8')).toContain('2.0.0');
    expect(await Bun.file(path.join(home, 'lib/libold.dylib')).exists()).toBe(false);
    expect(r.out).toContain('st4s migrate');
  });

  it.skipIf(process.platform !== 'darwin')(
    'clears the quarantine flag on installed files',
    async () => {
      const tarball = await fakeTarball({ quarantineLib: true });
      // Precondition: the flag survives extraction, so install.sh really has something to remove.
      const probe = path.join(work, 'probe');
      await mkdir(probe);
      expect(run(['tar', '-xzf', tarball, '-C', probe]).code).toBe(0);
      expect(
        run(['xattr', '-p', QUARANTINE, path.join(probe, 'st4s/lib/libfake.dylib')]).code,
      ).toBe(0);

      expect(install(tarball).code).toBe(0);
      const after = run(['xattr', '-p', QUARANTINE, path.join(home, 'lib/libfake.dylib')]);
      expect(after.code).not.toBe(0);
    },
  );

  it('accepts a matching .sha256 next to the tarball', async () => {
    const tarball = await fakeTarball();
    const sum = new Bun.CryptoHasher('sha256').update(await readFile(tarball)).digest('hex');
    await writeFile(`${tarball}.sha256`, `${sum}  ${path.basename(tarball)}\n`);
    const r = install(tarball);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`sha256 ok: ${sum}`);
  });

  it('rejects a tarball whose .sha256 does not match and keeps the old install', async () => {
    await mkdir(home, { recursive: true });
    await writeFile(path.join(home, 'st4s'), 'old binary');
    const tarball = await fakeTarball();
    await writeFile(`${tarball}.sha256`, `${'0'.repeat(64)}  ${path.basename(tarball)}\n`);
    const r = install(tarball);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('sha256 mismatch');
    expect(await readFile(path.join(home, 'st4s'), 'utf8')).toBe('old binary');
  });

  it('rejects a tarball built for another platform', async () => {
    const other = HOST === 'linux-x64' ? 'darwin-arm64' : 'linux-x64';
    const r = install(await fakeTarball({ platform: other }));
    expect(r.code).not.toBe(0);
    expect(r.out).toContain(`tarball is for ${other}`);
    expect(await Bun.file(path.join(home, 'st4s')).exists()).toBe(false);
  });
});
