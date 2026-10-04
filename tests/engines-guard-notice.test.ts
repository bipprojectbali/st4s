/** /dev/engines memory guard: the alert title/color follow the real state, the summary always shows thresholds and budgets. */
import { describe, expect, test } from 'bun:test';
import { type Guard, guardNotice, guardSummary } from '../app/components/engines/guard-notice';

const NOW = Date.parse('2026-10-04T12:00:00Z');
const T = { warnPct: 30, criticalPct: 20, emergencyPct: 12, recoverPct: 40, recoverSec: 30 };
const fmt = (iso: string) => iso.slice(11, 16);
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

const guard = (over: Partial<Guard> = {}): Guard => ({
  enabled: true,
  active: true,
  level: 'normal',
  freePct: 72,
  pressure: 1,
  shedding: false,
  lastAction: null,
  budgetMb: { stt: 2600, tts: 600 },
  reservedMb: 0,
  lastRefusal: null,
  ...over,
});

describe('guardSummary', () => {
  test('shows level, free RAM, thresholds and budgets while normal', () => {
    expect(guardSummary(guard(), T)).toBe(
      'Guard: normal · sisa 72% · ambang menipis 30% / kritis 20% / darurat 12% · budget STT 2.600 MB / TTS 600 MB',
    );
  });
  test('flags shedding, disabled budgets and reservations', () => {
    const s = guardSummary(
      guard({ level: 'warn', shedding: true, budgetMb: { stt: 0, tts: 600 }, reservedMb: 600 }),
      null,
    );
    expect(s).toBe(
      'Guard: menipis, menolak request · sisa 72% · budget STT tanpa cek / TTS 600 MB · dipesan 600 MB',
    );
  });
  test('says the guard is off when disabled', () => {
    expect(guardSummary(guard({ enabled: false }), T)).toContain('nonaktif');
  });
});

describe('guardNotice', () => {
  test('no alert while normal and nothing recent', () => {
    expect(guardNotice(guard(), NOW, fmt, T)).toBeNull();
    const old = {
      kind: 'unload' as const,
      engine: 'stt' as const,
      reason: 'busy' as const,
      at: ago(90),
      ok: true,
    };
    expect(guardNotice(guard({ lastAction: old }), NOW, fmt, T)).toBeNull();
  });
  test('shedding after RAM recovered: title is the rejection, not "normal", body says what it waits for', () => {
    const n = guardNotice(guard({ shedding: true }), NOW, fmt, T);
    expect(n?.title).toBe('Request audio ditolak sampai RAM pulih (sisa 72%)');
    expect(n?.title).not.toContain('normal');
    expect(n?.color).toBe('orange');
    expect(n?.lines[0]).toContain('≥ 40% selama 30 detik');
  });
  test('shedding at critical is red', () => {
    const n = guardNotice(guard({ shedding: true, level: 'critical', freePct: 18 }), NOW, fmt, T);
    expect(n?.color).toBe('red');
    expect(n?.title).toBe('Request audio ditolak sampai RAM pulih (sisa 18%)');
  });
  test('recent auto-unload without shedding names the engine', () => {
    const at = ago(5);
    const n = guardNotice(
      guard({ lastAction: { kind: 'unload', engine: 'stt', reason: 'busy', at, ok: true } }),
      NOW,
      fmt,
      T,
    );
    expect(n?.title).toBe('STT di-unload otomatis — RAM kritis');
    expect(n?.color).toBe('orange');
    expect(n?.lines).toHaveLength(1);
    expect(n?.lines[0]).toContain(`pada ${fmt(at)}`);
  });
  test('failed emergency unload is red', () => {
    const n = guardNotice(
      guard({
        lastAction: { kind: 'unload', engine: 'tts', reason: 'emergency', at: ago(1), ok: false },
      }),
      NOW,
      fmt,
      T,
    );
    expect(n?.title).toBe('TTS di-unload otomatis — RAM darurat');
    expect(n?.color).toBe('red');
    expect(n?.lines[0]).toContain('cek Server Logs');
  });
  test('budget refusal', () => {
    const n = guardNotice(
      guard({ lastRefusal: { engine: 'stt', neededMb: 2600, availableMb: 1800, at: ago(2) } }),
      NOW,
      fmt,
      T,
    );
    expect(n?.title).toBe('Memuat STT ditolak: RAM tidak cukup');
    expect(n?.lines[0]).toContain('butuh 2.600 MB, tersedia 1.800 MB');
  });
  test('disabled guard never alerts', () => {
    expect(guardNotice(guard({ enabled: false, shedding: true }), NOW, fmt, T)).toBeNull();
  });
});
