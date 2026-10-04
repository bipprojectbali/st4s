/** Available system RAM: macOS memorystatus level (what `memory_pressure` reports), os.freemem() elsewhere. */
import os from 'node:os';
import { logger } from './logger';

const CACHE_MS = 5000;

/** Injection points for tests; defaults are the real platform, sysctl, os and clock. */
export type MemoryProbe = {
  platform?: NodeJS.Platform;
  sysctl?: () => string;
  totalmem?: () => number;
  freemem?: () => number;
};

function runSysctl(): string {
  const r = Bun.spawnSync(['sysctl', '-n', 'kern.memorystatus_level'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (!r.success) throw new Error(`sysctl exited ${r.exitCode}: ${r.stderr.toString().trim()}`);
  return r.stdout.toString();
}

/**
 * Bytes the OS can hand out. On darwin os.freemem() counts only free pages (tens of MB on a busy
 * Mac), so use kern.memorystatus_level (percent available) × total; fall back to freemem on failure.
 */
export function readAvailableMemory(probe: MemoryProbe = {}): number {
  const platform = probe.platform ?? process.platform;
  const totalmem = probe.totalmem ?? os.totalmem;
  const freemem = probe.freemem ?? os.freemem;
  if (platform !== 'darwin') return freemem();
  try {
    const raw = (probe.sysctl ?? runSysctl)().trim();
    const pct = Number(raw);
    if (!/^\d+$/.test(raw) || pct > 100)
      throw new Error(`unexpected kern.memorystatus_level: "${raw}"`);
    return Math.round((pct / 100) * totalmem());
  } catch (err) {
    logger.warn({ err }, 'kern.memorystatus_level unavailable; reporting os.freemem()');
    return freemem();
  }
}

let cache: { at: number; bytes: number } | null = null;

/** readAvailableMemory() cached for 5 s so the 3 s /dev/engines poll does not spawn sysctl each time. */
export function availableMemoryBytes(now = Date.now()): number {
  if (cache && now - cache.at < CACHE_MS) return cache.bytes;
  cache = { at: now, bytes: readAvailableMemory() };
  return cache.bytes;
}
