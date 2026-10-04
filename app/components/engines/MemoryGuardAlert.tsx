import { Alert, Text } from '@mantine/core';
import { FiAlertTriangle } from 'react-icons/fi';
import type { EngineOverview } from '~/lib/engines-api';

type Guard = EngineOverview['memoryGuard'];

const RECENT_MS = 60 * 60 * 1000;

const LEVEL_TEXT: Record<Guard['level'], string> = {
  normal: 'normal',
  warn: 'menipis',
  critical: 'kritis',
  emergency: 'darurat',
};

const REASON_TEXT: Record<NonNullable<Guard['lastAction']>['reason'], string> = {
  idle: 'sedang idle',
  busy: 'masih bekerja, RAM tetap kritis',
  emergency: 'RAM darurat',
};

/** Compact notice on /dev/engines while RAM is low or the memory guard unloaded an engine in the last hour. */
export function MemoryGuardAlert({ guard, now, dateTime }: { guard: Guard; now: number; dateTime: (iso: string) => string }) {
  const last = guard.lastAction;
  const recent = last !== null && now - Date.parse(last.at) < RECENT_MS;
  if (!guard.enabled || (guard.level === 'normal' && !guard.shedding && !recent)) return null;
  const severe = guard.level === 'critical' || guard.level === 'emergency';
  return (
    <Alert
      color={severe ? 'red' : 'orange'}
      variant="light"
      icon={<FiAlertTriangle size={16} />}
      title={`Memory guard: RAM ${LEVEL_TEXT[guard.level]}${guard.freePct !== null ? ` (sisa ${guard.freePct}%)` : ''}`}
    >
      {guard.shedding && (
        <Text size="sm">
          Permintaan audio baru dan warmup ditolak (503) sampai RAM pulih. Tutup aplikasi lain yang berat bila ini
          berlangsung lama.
        </Text>
      )}
      {recent && last && (
        <Text size="sm">
          {last.engine.toUpperCase()} di-unload otomatis pada {dateTime(last.at)} ({REASON_TEXT[last.reason]})
          {last.ok ? '' : ' — unload belum selesai, cek Server Logs'}. Engine tidak dimuat ulang otomatis; warmup
          manual setelah RAM pulih.
        </Text>
      )}
    </Alert>
  );
}
