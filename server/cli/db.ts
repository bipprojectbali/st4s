/** `st4s db backup [--out <file>]` and `st4s db restore <file> [--yes]` for the built-in Postgres. Must not import server/env.ts. */
import { backupDb, type RestorePlan, restoreDb } from '../local-pg/backup';

const USAGE = `Pemakaian:
  st4s db backup [--out <file>]   arsipkan data PostgreSQL bawaan (st4s harus berhenti dulu)
  st4s db restore <file> [--yes]  pulihkan arsip; data saat ini dipindah, tidak dihapus`;

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const sec = (ms: number) => `${(ms / 1000).toFixed(1)} detik`;

/** y/N on a TTY; without a TTY only `--yes` may proceed. */
export function confirmRestore(yes: boolean, isTty = Boolean(process.stdin.isTTY)) {
  return (plan: RestorePlan): boolean => {
    if (yes) return true;
    if (!isTty)
      throw new Error('Bukan terminal interaktif — tambahkan --yes untuk menjalankan restore.');
    const move = plan.previous
      ? `data saat ini dipindah ke ${plan.previous} (tidak dihapus)`
      : 'belum ada data saat ini';
    console.log(
      `Restore ${plan.file}\n  dibuat ${plan.manifest.createdAt} oleh st4s ${plan.manifest.st4sVersion}\n  ${move}\n  data dari backup dipasang di ${plan.dataDir}`,
    );
    return prompt('Lanjutkan? [y/N]')?.trim().toLowerCase() === 'y';
  };
}

export async function runDb(args: string[], env = process.env): Promise<number> {
  const [sub, ...rest] = args;
  try {
    if (sub === 'backup' && (rest.length === 0 || (rest[0] === '--out' && rest.length === 2))) {
      const r = await backupDb(rest[1], { env });
      console.log(`✅ Backup selesai: ${r.file} (${mb(r.bytes)}, ${sec(r.ms)})`);
      return 0;
    }
    const yes = rest.includes('--yes');
    const files = rest.filter((a) => a !== '--yes');
    if (sub === 'restore' && files.length === 1 && !files[0]?.startsWith('-')) {
      const r = await restoreDb(files[0] as string, confirmRestore(yes), { env });
      console.log(`✅ Restore selesai (${sec(r.ms)}): ${r.dataDir}`);
      if (r.previous)
        console.log(
          `   Data sebelumnya disimpan di ${r.previous} — hapus manual bila tidak diperlukan.`,
        );
      if (r.migrateHint)
        console.log(
          `   Backup dibuat oleh st4s ${r.manifest.st4sVersion} — jalankan \`st4s migrate\` sebelum start bila skemanya lebih lama.`,
        );
      return 0;
    }
  } catch (e) {
    console.error(`❌ ${(e as Error).message}`);
    return 1;
  }
  if (sub === '--help' || sub === 'help') {
    console.log(USAGE);
    return 0;
  }
  console.error(USAGE);
  return 2;
}
