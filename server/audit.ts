/**
 * Audit trail for privileged console actions. Every mutating admin/settings
 * endpoint calls `audit()`; writes are best-effort (logged, never thrown) so a
 * failing audit insert can never block the action itself.
 */
import { db } from './db';
import { auditLog } from './db/schema';
import { logger } from './logger';
import { resolveClientIp } from './middleware/client-ip';

export const AUDIT_ACTIONS = {
  USER_ROLE_SET: 'user.role.set',
  USER_BAN: 'user.ban',
  USER_UNBAN: 'user.unban',
  USER_DELETE: 'user.delete',
  USER_IMPERSONATE: 'user.impersonate',
  SESSION_REVOKE: 'session.revoke',
  SETTINGS_AUTH_UPDATE: 'settings.auth.update',
  SETTINGS_RATE_LIMIT_UPDATE: 'settings.rate_limit.update',
  SETTINGS_RATE_LIMIT_RESET: 'settings.rate_limit.reset',
  LOGS_PURGE: 'logs.purge',
  LOGS_DELETE: 'logs.delete',
  LOGS_RETENTION: 'logs.retention',
  SETTINGS_RETENTION_UPDATE: 'settings.retention.update',
  SETTINGS_MAINTENANCE_UPDATE: 'settings.maintenance.update',
  SETTINGS_FEATURES_UPDATE: 'settings.features.update',
  SETTINGS_BRANDING_UPDATE: 'settings.branding.update',
  OPS_RESET: 'ops.reset',
  POST_UPDATE: 'post.update',
  POST_DELETE: 'post.delete',
  APIKEY_CREATE: 'apikey.create',
  APIKEY_UPDATE: 'apikey.update',
  APIKEY_ROTATE: 'apikey.rotate',
  APIKEY_REVOKE: 'apikey.revoke',
  APIKEY_DELETE: 'apikey.delete',
  ENGINE_WARMUP: 'engine.warmup',
  ENGINE_UNLOAD: 'engine.unload',
  ENGINE_AUTO_UNLOAD: 'engine.auto_unload',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
export type AuditTargetType =
  | 'user'
  | 'session'
  | 'settings'
  | 'logs'
  | 'post'
  | 'apikey'
  | 'engine';

export type AuditInput = {
  actor: { id: string; email?: string | null } | null;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId?: string | null;
  summary: string;
  meta?: Record<string, unknown>;
  /** Request headers for IP / user agent (optional for hook-originated entries). */
  headers?: Headers | null;
};

const MAX_UA = 512;

const FK_VIOLATION = '23503';

function isFkViolation(err: unknown): boolean {
  const cause = (err as { cause?: { code?: string }; code?: string }) ?? {};
  return cause.code === FK_VIOLATION || cause.cause?.code === FK_VIOLATION;
}

export async function audit(input: AuditInput): Promise<void> {
  const row = {
    actorId: input.actor?.id ?? null,
    actorEmail: input.actor?.email ?? null,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    summary: input.summary,
    meta: input.meta ?? null,
    ip: input.headers ? resolveClientIp(input.headers) : null,
    userAgent: input.headers?.get('user-agent')?.slice(0, MAX_UA) ?? null,
  };
  try {
    await db.insert(auditLog).values(row);
  } catch (err) {
    // Actor row already gone (deleted between action and write) or an
    // unknown id: keep the entry with the email snapshot instead of dropping it.
    if (isFkViolation(err) && row.actorId) {
      try {
        await db.insert(auditLog).values({ ...row, actorId: null });
        return;
      } catch (retryErr) {
        logger.warn({ err: retryErr, action: input.action }, 'failed to write audit_log');
        return;
      }
    }
    logger.warn({ err, action: input.action }, 'failed to write audit_log');
  }
}
