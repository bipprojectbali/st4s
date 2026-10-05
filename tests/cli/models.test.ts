import { afterAll, afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runModels } from '../../server/cli/models';
import { FIXTURE_FILES, fixtureSpecs, startFixture } from '../models/fixture';

const fx = startFixture();
afterAll(() => fx.stop());

let home = '';
let out: string[] = [];
let spies: ReturnType<typeof spyOn>[] = [];

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'st4s-home-'));
  out = [];
  fx.requests.length = 0;
  const push = (...a: unknown[]) => out.push(a.join(' '));
  spies = [
    spyOn(console, 'log').mockImplementation(push),
    spyOn(console, 'error').mockImplementation(push),
  ];
});
afterEach(async () => {
  for (const s of spies) s.mockRestore();
  await rm(home, { recursive: true, force: true });
});

const run = (args: string[], manifest = fx.manifest()) =>
  runModels(args, { manifest, env: { ST4S_HOME: home } });
const text = () => out.join('\n');

describe('st4s models', () => {
  it('list reports missing files, total size, location and licenses', async () => {
    expect(await run(['list'])).toBe(0);
    expect(text()).toContain(`Direktori model: ${path.join(home, 'models')}`);
    expect(text()).toContain('[missing ] stt/a.bin');
    expect(text()).toContain('Total: 4 file');
    expect(text()).toContain('OpenRAIL-M');
  });

  it('pull downloads + verifies everything, writes tts/LICENSE, then skips valid files', async () => {
    expect(await run(['pull'])).toBe(0);
    for (const dest of Object.keys(FIXTURE_FILES)) {
      expect(await Bun.file(path.join(home, 'models', dest)).exists()).toBe(true);
    }
    const license = await Bun.file(path.join(home, 'models/tts/LICENSE')).text();
    expect(license.startsWith('BigScience Open RAIL-M License')).toBe(true);

    fx.requests.length = 0;
    out = [];
    expect(await run(['pull'])).toBe(0);
    expect(fx.requests).toHaveLength(0);
    expect(text()).toContain('sudah ada dan valid');

    out = [];
    await run(['list']);
    expect(text()).toContain('ada 4, hilang 0');
  });

  it('pull stt only touches the stt group', async () => {
    expect(await run(['pull', 'stt'])).toBe(0);
    expect(await Bun.file(path.join(home, 'models/stt/b.bin')).exists()).toBe(true);
    expect(await Bun.file(path.join(home, 'models/tts/onnx/c.onnx')).exists()).toBe(false);
  });

  it('pull exits 1 on a bad hash and keeps no final file', async () => {
    const bad = fx.manifest(fixtureSpecs({ 'stt/b.bin': { sha256: 'f'.repeat(64) } }));
    expect(await run(['pull'], bad)).toBe(1);
    expect(text()).toContain('stt/b.bin GAGAL');
    expect(await Bun.file(path.join(home, 'models/stt/b.bin')).exists()).toBe(false);
    expect(await Bun.file(path.join(home, 'models/stt/a.bin')).exists()).toBe(true);
  });

  it('import fills the models dir from a local folder', async () => {
    const src = path.join(home, 'pack');
    for (const [dest, data] of Object.entries(FIXTURE_FILES)) {
      await Bun.write(path.join(src, 'nested', path.basename(dest)), data);
    }
    expect(await run(['import', src])).toBe(0);
    expect(text()).toContain('Diimpor 4, sudah ada 0, masih hilang 0');
    expect(await Bun.file(path.join(home, 'models/tts/LICENSE')).exists()).toBe(true);
    expect(await Bun.file(path.join(src, 'nested/a.bin')).exists()).toBe(true);
  });

  it('rejects bad usage and a missing ST4S_HOME', async () => {
    expect(await run(['pull', 'xyz'])).toBe(2);
    expect(await run(['frobnicate'])).toBe(2);
    expect(await run([])).toBe(2);
    expect(await runModels(['list'], { env: {} })).toBe(2);
    expect(text()).toContain('ST4S_HOME belum di-set');
  });
});
