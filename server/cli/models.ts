/** `st4s models list | pull [stt|tts|all] | import [path…] [--move]` — returns the exit code. */
import { mkdir, statfs, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { downloadModel } from '../models/download';
import { importModels, legacyModelDirs } from '../models/import';
import supertonicLicense from '../models/licenses/supertonic-3-OpenRAIL-M.txt' with {
  type: 'text',
};
import {
  LICENSE_NOTES,
  type ModelFile,
  type ModelGroup,
  modelManifest,
  selectGroup,
} from '../models/manifest';
import { fileSize, isValidFile, sizeState } from '../models/verify';
import { st4sModelsDir } from '../st4s-home';

const USAGE = `Pemakaian: st4s models <perintah>
  list                    status tiap file model, total ukuran, lisensi
  pull [stt|tts|all]      unduh file yang belum ada/rusak (bisa dilanjutkan), default all
  import [path…] [--move] salin file model dari folder/file lokal
                          (default: ~/.cache/crispasr dan ~/.wibu/tts/model)
Mirror: set ST4S_MODELS_BASE_URL (default https://huggingface.co).`;

export interface ModelsOptions {
  manifest?: ModelFile[];
  env?: Record<string, string | undefined>;
}

export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GiB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MiB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${n} B`;
}

async function writeTtsLicense(modelsDir: string): Promise<void> {
  const file = path.join(modelsDir, 'tts/LICENSE');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, supertonicLicense);
}

function printLicenses(files: ModelFile[]): void {
  console.log('Lisensi:');
  for (const lic of new Set(files.map((f) => f.license))) {
    console.log(`  ${lic}: ${LICENSE_NOTES[lic]}`);
  }
}

async function list(files: ModelFile[], dir: string): Promise<number> {
  console.log(`Direktori model: ${dir}`);
  const counts = { present: 0, missing: 0, 'bad-size': 0 };
  for (const f of files) {
    const state = await sizeState(path.join(dir, f.dest), f.size);
    counts[state]++;
    console.log(`  [${state.padEnd(8)}] ${f.dest} (${formatBytes(f.size)}, ${f.license})`);
  }
  const total = files.reduce((n, f) => n + f.size, 0);
  console.log(
    `Total: ${files.length} file, ${formatBytes(total)} — ada ${counts.present}, hilang ${counts.missing}, ukuran salah ${counts['bad-size']}`,
  );
  printLicenses(files);
  return 0;
}

function progressPrinter(label: string): (done: number, total: number) => void {
  if (!process.stdout.isTTY) return () => {};
  let last = -1;
  return (done, total) => {
    const pct = Math.floor((done / total) * 100);
    if (pct === last) return;
    last = pct;
    process.stdout.write(`\r  ${label} ${pct}% (${formatBytes(done)}/${formatBytes(total)})`);
  };
}

async function pull(files: ModelFile[], dir: string, group: ModelGroup | 'all'): Promise<number> {
  const selected = selectGroup(files, group);
  await mkdir(dir, { recursive: true });
  console.log(`Memeriksa ${selected.length} file di ${dir}…`);
  const todo: ModelFile[] = [];
  let needed = 0;
  for (const f of selected) {
    const dest = path.join(dir, f.dest);
    if (await isValidFile(dest, f)) continue;
    todo.push(f);
    needed += f.size - Math.min((await fileSize(`${dest}.part`)) ?? 0, f.size);
  }
  if (selected.some((f) => f.group === 'tts')) await writeTtsLicense(dir);
  if (todo.length === 0) {
    console.log('Semua file model sudah ada dan valid.');
    return 0;
  }
  const disk = await statfs(dir);
  const free = disk.bavail * disk.bsize;
  if (free < needed) {
    console.error(
      `Ruang disk kurang: butuh ${formatBytes(needed)}, tersedia ${formatBytes(free)} di ${dir}.`,
    );
    return 1;
  }
  console.log(`Mengunduh ${todo.length} file (${formatBytes(needed)}).`);
  const failed: string[] = [];
  for (const [i, f] of todo.entries()) {
    const label = `[${i + 1}/${todo.length}] ${f.dest}`;
    try {
      await downloadModel(f, path.join(dir, f.dest), progressPrinter(label));
      if (process.stdout.isTTY) process.stdout.write('\n');
      console.log(`  ${label} OK (${formatBytes(f.size)}, sha256 cocok)`);
    } catch (e) {
      if (process.stdout.isTTY) process.stdout.write('\n');
      console.error(`  ${label} GAGAL: ${(e as Error).message}`);
      failed.push(f.dest);
    }
  }
  if (selected.some((f) => f.license === 'OpenRAIL-M')) {
    console.log(
      `Catatan: Supertonic 3 berlisensi OpenRAIL-M dengan batasan penggunaan — ${path.join(dir, 'tts/LICENSE')}.`,
    );
  }
  if (failed.length > 0) {
    console.error(`${failed.length} file gagal diunduh. Jalankan ulang \`st4s models pull\`.`);
    return 1;
  }
  console.log('Selesai: semua file model valid.');
  return 0;
}

async function runImport(files: ModelFile[], dir: string, args: string[]): Promise<number> {
  const move = args.includes('--move');
  const sources = args.filter((a) => a !== '--move');
  const from = sources.length > 0 ? sources : legacyModelDirs();
  console.log(`Mencari file model di: ${from.join(', ')}`);
  const r = await importModels(files, dir, from, {
    move,
    onFile: (dest, status) => {
      const verb = status === 'skipped' ? 'sudah ada' : move ? 'dipindah' : 'disalin';
      console.log(`  ${verb}: ${dest}`);
    },
  });
  if ([...r.imported, ...r.skipped].some((d) => d.startsWith('tts/'))) await writeTtsLicense(dir);
  console.log(
    `Diimpor ${r.imported.length}, sudah ada ${r.skipped.length}, masih hilang ${r.missing.length}.`,
  );
  if (r.missing.length > 0) {
    for (const m of r.missing) console.log(`  hilang: ${m}`);
    console.log('Lengkapi dengan `st4s models pull` atau import dari folder lain.');
    return 1;
  }
  return 0;
}

export async function runModels(args: string[], opts: ModelsOptions = {}): Promise<number> {
  const env = opts.env ?? process.env;
  const [cmd, ...rest] = args;
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    console.log(USAGE);
    return cmd ? 0 : 2;
  }
  const dir = st4sModelsDir(env);
  if (!dir) {
    console.error('ST4S_HOME belum di-set; jalankan dari binary st4s atau set ST4S_HOME.');
    return 2;
  }
  const files = opts.manifest ?? modelManifest(undefined, env);
  try {
    if (cmd === 'list') return await list(files, dir);
    if (cmd === 'pull') {
      const group = rest[0] ?? 'all';
      if (group !== 'stt' && group !== 'tts' && group !== 'all') {
        console.error(`Grup tidak dikenal: ${group} (pilih stt, tts, atau all).`);
        return 2;
      }
      return await pull(files, dir, group);
    }
    if (cmd === 'import') return await runImport(files, dir, rest);
  } catch (e) {
    console.error(`st4s models ${cmd} gagal: ${(e as Error).message}`);
    return 1;
  }
  console.error(`Perintah tidak dikenal: ${cmd}\n${USAGE}`);
  return 2;
}
