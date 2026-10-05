/** Resumable download of one model file: `<dest>.part` + HTTP Range, sha256 verify, atomic rename. */
import { mkdir, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { ModelFile } from './manifest';
import { fileSize, sha256File } from './verify';

export type Progress = (done: number, total: number) => void;
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

// ponytail: no stall timeout; a hung connection waits for the OS socket timeout — Ctrl+C and rerun resumes.
export async function downloadModel(
  file: Pick<ModelFile, 'url' | 'size' | 'sha256'>,
  dest: string,
  onProgress?: Progress,
  fetchImpl: Fetch = fetch,
): Promise<void> {
  await mkdir(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  let offset = (await fileSize(part)) ?? 0;
  if (offset > file.size) {
    await rm(part, { force: true });
    offset = 0;
  }

  if (offset < file.size) {
    const headers: Record<string, string> = offset > 0 ? { Range: `bytes=${offset}-` } : {};
    let res: Response;
    try {
      res = await fetchImpl(file.url, { headers, redirect: 'follow' });
    } catch (e) {
      throw new Error(`gagal menghubungi ${file.url}: ${(e as Error).message}`);
    }
    if (res.status === 416) {
      await rm(part, { force: true });
      throw new Error('server menolak lanjutan unduhan (HTTP 416); .part dihapus, jalankan ulang');
    }
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} dari ${file.url}`);
    // 200 on a Range request means the server ignored it: restart from zero.
    if (res.status !== 206) offset = 0;

    let done = offset;
    const fh = await open(part, offset > 0 ? 'a' : 'w');
    try {
      for await (const chunk of res.body) {
        await fh.write(chunk);
        done += chunk.byteLength;
        onProgress?.(done, file.size);
      }
    } catch (e) {
      throw new Error(
        `unduhan terputus di ${done}/${file.size} B (${(e as Error).message}); jalankan ulang untuk melanjutkan`,
      );
    } finally {
      await fh.close();
    }
    if (done < file.size) {
      throw new Error(
        `unduhan terputus di ${done}/${file.size} B; jalankan ulang untuk melanjutkan`,
      );
    }
  }

  const size = await fileSize(part);
  if (size !== file.size) {
    await rm(part, { force: true });
    throw new Error(`ukuran salah (${size} B, harus ${file.size} B); .part dihapus`);
  }
  const hash = await sha256File(part);
  if (hash !== file.sha256) {
    await rm(part, { force: true });
    throw new Error(`sha256 tidak cocok (${hash}); .part dihapus`);
  }
  await rename(part, dest);
}
