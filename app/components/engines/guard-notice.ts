import type { EngineOverview } from '~/lib/engines-api';

export type Guard = EngineOverview['memoryGuard'];

/** Static MEM_GUARD_* thresholds (free RAM %) read once by the page loader. */
export type GuardThresholds = {
  warnPct: number;
  criticalPct: number;
  emergencyPct: number;
  recoverPct: number;
  recoverSec: number;
};

export type GuardNotice = { color: 'red' | 'orange'; title: string; lines: string[] };

/** Actions older than this no longer raise the alert. */
export const RECENT_MS = 60 * 60 * 1000;

export const LEVEL_TEXT: Record<Guard['level'], string> = {
  normal: 'normal',
  warn: 'menipis',
  critical: 'kritis',
  emergency: 'darurat',
};

export const LEVEL_COLOR: Record<Guard['level'], string> = {
  normal: 'teal',
  warn: 'orange',
  critical: 'red',
  emergency: 'red',
};

const REASON_TEXT: Record<NonNullable<Guard['lastAction']>['reason'], string> = {
  idle: 'sedang idle',
  busy: 'masih bekerja, RAM tetap kritis',
  emergency: 'RAM darurat',
};

const mb = (n: number) => `${n.toLocaleString('id-ID')} MB`;
const budget = (n: number) => (n > 0 ? mb(n) : 'tanpa cek');
const free = (g: Guard) => (g.freePct === null ? '' : ` (sisa ${g.freePct}%)`);

/** One-line, always-visible guard state: level, free RAM, thresholds and cold-load budgets. */
export function guardSummary(g: Guard, t: GuardThresholds | null): string {
  if (!g.enabled)
    return 'Memory guard nonaktif (MEM_GUARD_ENABLED=false) — tidak ada perlindungan RAM.';
  const parts = [
    `Guard: ${LEVEL_TEXT[g.level]}${g.shedding ? ', menolak request' : ''}`,
    `sisa ${g.freePct === null ? '—' : `${g.freePct}%`}`,
  ];
  if (t)
    parts.push(
      `ambang menipis ${t.warnPct}% / kritis ${t.criticalPct}% / darurat ${t.emergencyPct}%`,
    );
  parts.push(`budget STT ${budget(g.budgetMb.stt)} / TTS ${budget(g.budgetMb.tts)}`);
  if (g.reservedMb > 0) parts.push(`dipesan ${mb(g.reservedMb)}`);
  return parts.join(' · ');
}

/**
 * Alert content derived from what is actually happening (shedding > recent auto-unload > budget refusal > low level),
 * or null when nothing needs attention. The title never says "normal".
 */
export function guardNotice(
  g: Guard,
  now: number,
  dateTime: (iso: string) => string,
  t: GuardThresholds | null,
): GuardNotice | null {
  if (!g.enabled) return null;
  const last = g.lastAction;
  const recent = last !== null && now - Date.parse(last.at) < RECENT_MS ? last : null;
  const refusal =
    g.lastRefusal !== null && now - Date.parse(g.lastRefusal.at) < RECENT_MS ? g.lastRefusal : null;
  const severe = g.level === 'critical' || g.level === 'emergency';
  const lines: string[] = [];

  if (g.shedding) {
    const wait =
      g.level === 'normal' && t
        ? ` RAM sudah${free(g)} — request diterima lagi setelah sisa RAM ≥ ${t.recoverPct}% selama ${t.recoverSec} detik.`
        : ' Tutup aplikasi lain yang berat bila ini berlangsung lama.';
    lines.push(`Permintaan audio baru dan warmup ditolak (503) sampai RAM pulih.${wait}`);
  }
  if (recent)
    lines.push(
      `${recent.engine.toUpperCase()} di-unload otomatis pada ${dateTime(recent.at)} (${REASON_TEXT[recent.reason]})${recent.ok ? '' : ' — unload belum selesai, cek Server Logs'}. Engine tidak dimuat ulang otomatis; warmup manual setelah RAM pulih.`,
    );
  if (refusal)
    lines.push(
      `Memuat ${refusal.engine.toUpperCase()} ditolak pada ${dateTime(refusal.at)}: butuh ${mb(refusal.neededMb)}, tersedia ${mb(refusal.availableMb)}.`,
    );

  let title: string;
  if (g.shedding) title = `Request audio ditolak sampai RAM pulih${free(g)}`;
  else if (recent)
    title = `${recent.engine.toUpperCase()} di-unload otomatis — RAM ${recent.reason === 'emergency' ? 'darurat' : 'kritis'}`;
  else if (refusal) title = `Memuat ${refusal.engine.toUpperCase()} ditolak: RAM tidak cukup`;
  else if (g.level !== 'normal') title = `RAM ${LEVEL_TEXT[g.level]}${free(g)}`;
  else return null;

  return { color: severe || (recent !== null && !recent.ok) ? 'red' : 'orange', title, lines };
}
