/** Size/sha256 checks for model files; hashing streams so a 1.5 GB file never sits in memory. */
import { stat } from 'node:fs/promises';

export type SizeState = 'present' | 'missing' | 'bad-size';

/** Streamed sha256 (hex) of a file. */
export async function sha256File(file: string): Promise<string> {
  const hasher = new Bun.CryptoHasher('sha256');
  for await (const chunk of Bun.file(file).stream()) hasher.update(chunk);
  return hasher.digest('hex');
}

/** Size of a regular file, or null when it does not exist. */
export async function fileSize(file: string): Promise<number | null> {
  try {
    const s = await stat(file);
    return s.isFile() ? s.size : null;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`Gagal membaca ${file}: ${(e as Error).message}`);
  }
}

/** Cheap check (size only) used by `models list`. */
export async function sizeState(file: string, expected: number): Promise<SizeState> {
  const size = await fileSize(file);
  if (size === null) return 'missing';
  return size === expected ? 'present' : 'bad-size';
}

/** Full check: right size and right sha256. */
export async function isValidFile(
  file: string,
  expected: { size: number; sha256: string },
): Promise<boolean> {
  if ((await fileSize(file)) !== expected.size) return false;
  return (await sha256File(file)) === expected.sha256;
}
