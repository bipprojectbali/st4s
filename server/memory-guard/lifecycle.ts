/** Start/stop the process-wide memory guard with the real RAM reader, engine registry and audit log. */
import { AUDIT_ACTIONS, audit } from '../audit';
import { getStt, getTts } from '../engines/registry';
import type { EngineControl } from '../engines/types';
import { logger } from '../logger';
import { readMemorySnapshot } from '../system-memory';
import { loadGuardConfig } from './config';
import { createMemoryGuard, type GuardAuditEntry, type MemoryGuard } from './guard';
import type { GuardEngine } from './machine';
import { setGuardHandle } from './state';
import { installSysctlFfi } from './sysctl-ffi';

const g = globalThis as typeof globalThis & { __st4sMemoryGuardRunner?: MemoryGuard };

const LABEL: Record<GuardEngine, string> = { stt: 'STT', tts: 'TTS' };

function registered(get: () => EngineControl): EngineControl | undefined {
  try {
    return get();
  } catch {
    return undefined; // not registered in this process: nothing to guard
  }
}

/** Audit one guard-initiated unload as engine.auto_unload (metrics only). */
export function auditAutoUnload(e: GuardAuditEntry): void {
  void audit({
    actor: null,
    action: AUDIT_ACTIONS.ENGINE_AUTO_UNLOAD,
    targetType: 'engine',
    targetId: e.engine,
    summary: `Unload otomatis engine ${LABEL[e.engine]} oleh memory guard (${e.level}, sisa RAM ${e.freePct ?? '?'}%)${e.ok ? '' : ' — belum selesai'}`,
    meta: {
      by: 'memory-guard',
      engine: e.engine,
      reason: e.reason,
      level: e.level,
      freePct: e.freePct,
      ms: e.ms,
      ok: e.ok,
    },
  });
}

/**
 * Validate MEM_GUARD_* (throws on a bad config so boot fails loudly), install the FFI reader and
 * start the guard once; returns null when MEM_GUARD_ENABLED=false.
 */
export function startMemoryGuard(): MemoryGuard | null {
  if (g.__st4sMemoryGuardRunner) return g.__st4sMemoryGuardRunner;
  const cfg = loadGuardConfig();
  if (!cfg.enabled) {
    logger.warn('memory guard disabled (MEM_GUARD_ENABLED=false)');
    return null;
  }
  installSysctlFfi();
  const guard = createMemoryGuard({
    cfg,
    read: () => readMemorySnapshot(),
    engines: () => ({ stt: registered(getStt), tts: registered(getTts) }),
    audit: auditAutoUnload,
  });
  g.__st4sMemoryGuardRunner = guard;
  setGuardHandle(guard);
  guard.start();
  logger.info(
    {
      warnPct: cfg.warnPct,
      criticalPct: cfg.criticalPct,
      emergencyPct: cfg.emergencyPct,
      recoverPct: cfg.recoverPct,
      budgetMb: cfg.budgetMb,
    },
    'memory guard started',
  );
  return guard;
}

/** Stop the timer chain and drop the handle (shutdown); no-op when not started. */
export function stopMemoryGuard(): void {
  g.__st4sMemoryGuardRunner?.stop();
  delete g.__st4sMemoryGuardRunner;
  setGuardHandle(null);
}
