/** Speech engine status and warmup/unload for /dev/engines (super-admin browser session only). */
import os from 'node:os';
import { Elysia } from 'elysia';
import { newRequestId } from '../api-error';
import { AUDIT_ACTIONS, audit } from '../audit';
import { checkEngineDeps } from '../engines/deps';
import { getStt, getTts } from '../engines/registry';
import { loadSttConfig } from '../engines/stt/config';
import { TTS_LANGUAGES } from '../engines/tts/text';
import type { EngineControl, EngineStatus } from '../engines/types';
import { resolveActor } from '../guard';
import { logger } from '../logger';
import { guardHandle, memoryGuardStatus } from '../memory-guard/state';
import { ROLES } from '../permissions';
import { availableMemoryBytes } from '../system-memory';
import { speechConfig } from '../v1/speech-config';

export const ENGINE_KINDS = ['stt', 'tts'] as const;
export type EngineKind = (typeof ENGINE_KINDS)[number];

const LABEL: Record<EngineKind, string> = { stt: 'STT', tts: 'TTS' };

/** The registered engine, or null when none is registered (getStt/getTts throw then). */
function engineOf(kind: EngineKind): EngineControl | null {
  try {
    return kind === 'stt' ? getStt() : getTts();
  } catch {
    return null;
  }
}

function statusOf(kind: EngineKind): EngineStatus | null {
  const e = engineOf(kind);
  if (!e) return null;
  try {
    return e.status();
  } catch (err) {
    logger.warn({ err, kind }, 'engine status() failed');
    return null;
  }
}

function ttsVoices(): string[] {
  try {
    return [...getTts().voices()];
  } catch {
    return [];
  }
}

/** Engine status, voices, default languages, dependency check, memory figures and memory-guard state (shared by the API and the page loader). */
export function engineOverview() {
  return {
    stt: statusOf('stt'),
    tts: statusOf('tts'),
    tts_voices: ttsVoices(),
    tts_languages: [...TTS_LANGUAGES] as string[],
    stt_default_language: loadSttConfig().defaultLanguage,
    tts_default_language: speechConfig.defaultLanguage,
    deps: checkEngineDeps(),
    memory: {
      serverRssBytes: process.memoryUsage().rss,
      freeBytes: availableMemoryBytes(),
      totalBytes: os.totalmem(),
    },
    memoryGuard: memoryGuardStatus(),
    generatedAt: new Date().toISOString(),
  };
}
export type EngineOverview = ReturnType<typeof engineOverview>;

const isKind = (k: string): k is EngineKind => (ENGINE_KINDS as readonly string[]).includes(k);

export const enginesApi = new Elysia({ prefix: '/engines' })
  .derive(async ({ request }) => ({ me: await resolveActor(request) }))
  .onBeforeHandle(({ me, status }) => {
    if (!me) return status(401, { error: 'Masuk dulu sebagai super-admin.', code: 'UNAUTHORIZED' });
    if (me.viaApiKey)
      return status(403, {
        error: 'Kontrol engine hanya lewat sesi browser, bukan API key.',
        code: 'API_KEY_NOT_ALLOWED',
      });
    if (me.role !== ROLES.SUPER_ADMIN)
      return status(403, {
        error: 'Hanya super-admin yang bisa mengakses engine.',
        code: 'FORBIDDEN',
      });
  })
  .get('/', () => engineOverview())
  .post('/:kind/:action', async ({ me, params, request, set, status }) => {
    const { kind, action } = params;
    if (!isKind(kind))
      return status(400, {
        error: `Jenis engine tidak dikenal: ${kind}. Pakai stt atau tts.`,
        code: 'BAD_KIND',
      });
    if (action !== 'warmup' && action !== 'unload')
      return status(404, { error: `Aksi tidak dikenal: ${action}.`, code: 'NOT_FOUND' });
    const engine = engineOf(kind);
    if (!engine)
      return status(503, {
        error: `Engine ${LABEL[kind]} tidak terdaftar di proses ini. Cek konfigurasi lalu restart server.`,
        code: 'ENGINE_NOT_REGISTERED',
      });
    if (action === 'warmup') {
      const a = guardHandle()?.admit();
      if (a && !a.ok) {
        set.headers['retry-after'] = String(a.retryAfterSec);
        return status(503, {
          error: `RAM server sedang menipis, warmup ${LABEL[kind]} ditunda. Tunggu RAM pulih lalu coba lagi dalam ${a.retryAfterSec} detik.`,
          code: 'MEMORY_PRESSURE',
          status: 503,
          requestId: newRequestId(),
        });
      }
    }
    const t0 = performance.now();
    try {
      await (action === 'warmup' ? engine.warmup() : engine.unload());
    } catch (err) {
      logger.error({ err, kind, action }, 'engine control failed');
      return status(503, {
        error: `Gagal ${action === 'warmup' ? 'memuat' : 'melepas'} engine ${LABEL[kind]}: ${(err as Error).message}. Cek Server Logs lalu coba lagi.`,
        code: action === 'warmup' ? 'ENGINE_WARMUP_FAILED' : 'ENGINE_UNLOAD_FAILED',
      });
    }
    const ms = Math.round(performance.now() - t0);
    void audit({
      actor: me?.user ?? null,
      headers: request.headers,
      action: action === 'warmup' ? AUDIT_ACTIONS.ENGINE_WARMUP : AUDIT_ACTIONS.ENGINE_UNLOAD,
      targetType: 'engine',
      targetId: kind,
      summary: `${action === 'warmup' ? 'Warmup' : 'Unload'} engine ${LABEL[kind]}`,
      meta: { ms },
    });
    return { ok: true, kind, action, ms, status: statusOf(kind) };
  });
