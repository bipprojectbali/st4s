import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { importModels, legacyModelDirs } from '../../server/models/import';
import { modelManifest } from '../../server/models/manifest';
import { sha256File } from '../../server/models/verify';
import { FIXTURE_FILES, fixtureSpecs, sha256 } from './fixture';

let root = '';
let src = '';
let models = '';
const manifest = () => modelManifest(fixtureSpecs(), {});

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'st4s-import-'));
  src = path.join(root, 'src');
  models = path.join(root, 'models');
  // Old dev layout: flat crispasr cache + nested Supertonic dir.
  await Bun.write(path.join(src, '.cache/crispasr/a.bin'), FIXTURE_FILES['stt/a.bin']);
  await Bun.write(path.join(src, '.cache/crispasr/b.bin'), new Uint8Array(1000)); // wrong bytes
  await Bun.write(path.join(src, '.wibu/tts/model/onnx/c.onnx'), FIXTURE_FILES['tts/onnx/c.onnx']);
  await Bun.write(
    path.join(src, '.wibu/tts/model/voice_styles/F1.json'),
    FIXTURE_FILES['tts/voice_styles/F1.json'],
  );
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('importModels', () => {
  it('copies verified files by name, never touches sources, reports missing', async () => {
    const r = await importModels(manifest(), models, [src]);
    expect(r.imported.sort()).toEqual(['stt/a.bin', 'tts/onnx/c.onnx', 'tts/voice_styles/F1.json']);
    expect(r.missing).toEqual(['stt/b.bin']);
    expect(await sha256File(path.join(models, 'stt/a.bin'))).toBe(
      sha256(FIXTURE_FILES['stt/a.bin']),
    );
    expect(await Bun.file(path.join(src, '.cache/crispasr/a.bin')).exists()).toBe(true);
    expect(await Bun.file(path.join(models, 'stt/b.bin')).exists()).toBe(false);

    const again = await importModels(manifest(), models, [src]);
    expect(again.imported).toEqual([]);
    expect(again.skipped).toHaveLength(3);
  });

  it('accepts a single file path and --move removes the source', async () => {
    const one = path.join(src, '.cache/crispasr/a.bin');
    const r = await importModels(manifest(), models, [one], { move: true });
    expect(r.imported).toEqual(['stt/a.bin']);
    expect(await Bun.file(one).exists()).toBe(false);
    expect(await Bun.file(path.join(models, 'stt/a.bin')).exists()).toBe(true);
  });

  it('ignores non-existent sources and defaults to the old dev dirs', async () => {
    const r = await importModels(manifest(), models, [path.join(root, 'nope')]);
    expect(r.missing).toHaveLength(4);
    expect(legacyModelDirs('/h')).toEqual(['/h/.cache/crispasr', '/h/.wibu/tts/model']);
  });
});
