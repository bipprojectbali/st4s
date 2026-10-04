/** Available system RAM: macOS memorystatus level (what `memory_pressure` reports), /proc/meminfo on Linux, os.freemem() as fallback. */
import { readFileSync } from 'node:fs';
import os from 'node:os';
import { logger } from './logger';

const CACHE_MS = 5000;

/** Injection points for tests; defaults are the real platform, sysctl, /proc/meminfo, os and clock. */
export type MemoryProbe = {
  platform?: NodeJS.Platform;
  /** kern.memorystatus_level as text. */
  sysctl?: () => string;
  /** kern.memorystatus_vm_pressure_level (1 normal / 2 warn / 4 critical), null when unreadable. */
  pressure?: () => number | null;
  meminfo?: () => string;
  totalmem?: () => number;
  freemem?: () => number;
};

export type MemorySnapshot = {
  freeBytes: number;
  totalBytes: number;
  /** Percent available; null when darwin fell back to os.freemem() (free pages only, far below what is really available). */
  freePct: number | null;
  /** macOS kernel pressure level; null on other platforms or when unreadable. */
  pressure: number | null;
};

/**
 * Fast darwin sysctl reader (libc sysctlbyname over bun:ffi, ~2 µs), installed by
 * server/memory-guard/sysctl-ffi.ts. Kept on globalThis so this module — also bundled by Vite
 * for SSR — never imports bun:ffi itself.
 */
const g = globalThis as typeof globalThis & { __s4sSysctlInt?: (name: string) => number };

function runSysctl(): string {
  const r = Bun.spawnSync(['sysctl', '-n', 'kern.memorystatus_level'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (!r.success) throw new Error(`sysctl exited ${r.exitCode}: ${r.stderr.toString().trim()}`);
  return r.stdout.toString();
}

function defaultLevel(): string {
  const ffi = g.__s4sSysctlInt;
  if (ffi) {
    try {
      return String(ffi('kern.memorystatus_level'));
    } catch (err) {
      logger.warn({ err }, 'sysctlbyname(kern.memorystatus_level) failed; spawning sysctl');
    }
  }
  return runSysctl();
}

function defaultPressure(): number | null {
  const ffi = g.__s4sSysctlInt;
  if (!ffi) return null;
  try {
    return ffi('kern.memorystatus_vm_pressure_level');
  } catch (err) {
    logger.warn({ err }, 'sysctlbyname(kern.memorystatus_vm_pressure_level) failed');
    return null;
  }
}

const pctOf = (free: number, total: number) =>
  total > 0 ? Math.round((free / total) * 1000) / 10 : 0;

function linuxSnapshot(probe: MemoryProbe): MemorySnapshot {
  try {
    const text = (probe.meminfo ?? (() => readFileSync('/proc/meminfo', 'utf8')))();
    const kb = (key: string) => Number(new RegExp(`^${key}:\\s+(\\d+) kB`, 'm').exec(text)?.[1]);
    const free = kb('MemAvailable') * 1024;
    const total = kb('MemTotal') * 1024;
    if (!(free >= 0 && total > 0))
      throw new Error('MemAvailable/MemTotal missing in /proc/meminfo');
    return { freeBytes: free, totalBytes: total, freePct: pctOf(free, total), pressure: null };
  } catch (err) {
    logger.warn({ err }, '/proc/meminfo unavailable; reporting os.freemem()');
    const free = (probe.freemem ?? os.freemem)();
    const total = (probe.totalmem ?? os.totalmem)();
    return { freeBytes: free, totalBytes: total, freePct: pctOf(free, total), pressure: null };
  }
}

/**
 * RAM the OS can hand out. On darwin os.freemem() counts only free pages (tens of MB on a busy
 * Mac), so use kern.memorystatus_level (percent available) × total; fall back to freemem on failure.
 */
export function readMemorySnapshot(probe: MemoryProbe = {}): MemorySnapshot {
  const platform = probe.platform ?? process.platform;
  if (platform !== 'darwin') return linuxSnapshot(probe);
  const total = (probe.totalmem ?? os.totalmem)();
  const pressure = (probe.pressure ?? defaultPressure)();
  try {
    const raw = (probe.sysctl ?? defaultLevel)().trim();
    const pct = Number(raw);
    if (!/^\d+$/.test(raw) || pct > 100)
      throw new Error(`unexpected kern.memorystatus_level: "${raw}"`);
    return {
      freeBytes: Math.round((pct / 100) * total),
      totalBytes: total,
      freePct: pct,
      pressure,
    };
  } catch (err) {
    logger.warn({ err }, 'kern.memorystatus_level unavailable; reporting os.freemem()');
    return {
      freeBytes: (probe.freemem ?? os.freemem)(),
      totalBytes: total,
      freePct: null,
      pressure,
    };
  }
}

/** Bytes the OS can hand out (see readMemorySnapshot). */
export function readAvailableMemory(probe: MemoryProbe = {}): number {
  return readMemorySnapshot(probe).freeBytes;
}

let cache: { at: number; bytes: number } | null = null;

/** readAvailableMemory() cached for 5 s so the 3 s /dev/engines poll stays cheap even on the sysctl spawn fallback. */
export function availableMemoryBytes(now = Date.now()): number {
  if (cache && now - cache.at < CACHE_MS) return cache.bytes;
  cache = { at: now, bytes: readAvailableMemory() };
  return cache.bytes;
}
