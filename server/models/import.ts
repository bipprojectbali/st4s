/** Offline install: find manifest files by name under source paths, verify, copy/move into the models dir. */
import { copyFile, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ModelFile } from './manifest';
import { isValidFile } from './verify';

/** Pre-bundle dev locations (STT_MODEL / TTS_MODEL_DIR defaults), searched when no path is given. */
export function legacyModelDirs(home = os.homedir()): string[] {
  return [path.join(home, '.cache/crispasr'), path.join(home, '.wibu/tts/model')];
}

export interface ImportResult {
  imported: string[];
  skipped: string[];
  missing: string[];
}

async function collectFiles(src: string, byName: Map<string, string[]>): Promise<void> {
  let s: Awaited<ReturnType<typeof stat>>;
  try {
    s = await stat(src);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw new Error(`Gagal membaca ${src}: ${(e as Error).message}`);
  }
  const add = (p: string) => {
    const name = path.basename(p);
    byName.set(name, [...(byName.get(name) ?? []), p]);
  };
  if (s.isFile()) return add(src);
  for (const d of await readdir(src, { recursive: true, withFileTypes: true })) {
    if (d.isFile()) add(path.join(d.parentPath, d.name));
  }
}

async function place(from: string, dest: string, move: boolean): Promise<void> {
  await mkdir(path.dirname(dest), { recursive: true });
  if (move) {
    try {
      await rename(from, dest);
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
    }
  }
  const part = `${dest}.part`;
  await copyFile(from, part);
  await rename(part, dest);
  if (move) await rm(from);
}

/**
 * For each manifest file not already valid in `modelsDir`, use the first same-named source file
 * with matching size + sha256. Sources are only read unless `move` is set.
 */
export async function importModels(
  files: ModelFile[],
  modelsDir: string,
  sources: string[],
  opts: { move?: boolean; onFile?: (dest: string, status: 'imported' | 'skipped') => void } = {},
): Promise<ImportResult> {
  const byName = new Map<string, string[]>();
  for (const src of sources) await collectFiles(path.resolve(src), byName);

  const result: ImportResult = { imported: [], skipped: [], missing: [] };
  for (const f of files) {
    const dest = path.join(modelsDir, f.dest);
    if (await isValidFile(dest, f)) {
      result.skipped.push(f.dest);
      opts.onFile?.(f.dest, 'skipped');
      continue;
    }
    let found: string | undefined;
    for (const candidate of byName.get(path.basename(f.dest)) ?? []) {
      if (path.resolve(candidate) === dest) continue;
      if (await isValidFile(candidate, f)) {
        found = candidate;
        break;
      }
    }
    if (!found) {
      result.missing.push(f.dest);
      continue;
    }
    try {
      await place(found, dest, opts.move === true);
    } catch (e) {
      throw new Error(`Gagal menyalin ${found} → ${dest}: ${(e as Error).message}`);
    }
    result.imported.push(f.dest);
    opts.onFile?.(f.dest, 'imported');
  }
  return result;
}
