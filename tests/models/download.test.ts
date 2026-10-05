import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { downloadModel } from '../../server/models/download';
import { sha256File } from '../../server/models/verify';
import { FIXTURE_FILES, fixtureSpecs, sha256, startFixture } from './fixture';

const fx = startFixture();
afterAll(() => fx.stop());

let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'st4s-dl-'));
  fx.requests.length = 0;
  fx.ignoreRange = false;
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const fileA = () => fx.manifest()[0]; // FIXTURE_FILES order: stt/a.bin first
const dataA = FIXTURE_FILES['stt/a.bin'];

describe('downloadModel', () => {
  it('downloads, verifies sha256 and leaves no .part', async () => {
    const dest = path.join(dir, 'stt/a.bin');
    const seen: number[] = [];
    await downloadModel(fileA(), dest, (done) => seen.push(done));
    expect(await sha256File(dest)).toBe(sha256(dataA));
    expect(await Bun.file(`${dest}.part`).exists()).toBe(false);
    expect(seen.at(-1)).toBe(dataA.byteLength);
  });

  it('resumes from an existing .part with an HTTP Range request', async () => {
    const dest = path.join(dir, 'stt/a.bin');
    await Bun.write(`${dest}.part`, dataA.slice(0, 1500));
    await downloadModel(fileA(), dest);
    expect(fx.requests.at(-1)?.range).toBe('bytes=1500-');
    expect(await sha256File(dest)).toBe(sha256(dataA));
  });

  it('restarts from zero when the server ignores Range', async () => {
    fx.ignoreRange = true;
    const dest = path.join(dir, 'stt/a.bin');
    await Bun.write(`${dest}.part`, dataA.slice(0, 1500));
    await downloadModel(fileA(), dest);
    expect(await sha256File(dest)).toBe(sha256(dataA));
  });

  it('fails on a bad hash and leaves neither the final file nor the .part', async () => {
    const [bad] = fx.manifest(fixtureSpecs({ 'stt/a.bin': { sha256: '0'.repeat(64) } }));
    const dest = path.join(dir, 'stt/a.bin');
    await expect(downloadModel(bad, dest)).rejects.toThrow('sha256 tidak cocok');
    expect(await Bun.file(dest).exists()).toBe(false);
    expect(await Bun.file(`${dest}.part`).exists()).toBe(false);
  });

  it('reports HTTP errors with the URL', async () => {
    const file = { ...fileA(), url: `${fx.url}/nope` };
    await expect(downloadModel(file, path.join(dir, 'x.bin'))).rejects.toThrow('HTTP 404');
  });

  it('discards a .part larger than the expected size', async () => {
    const dest = path.join(dir, 'stt/a.bin');
    await Bun.write(`${dest}.part`, new Uint8Array(dataA.byteLength + 10));
    await downloadModel(fileA(), dest);
    expect(fx.requests.at(-1)?.range).toBeNull();
    expect(await sha256File(dest)).toBe(sha256(dataA));
  });
});
