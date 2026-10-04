/** OpenAI Realtime (transcription session) client events and readable error text for /dev. */
import type {
  InputAudioBufferAppendEvent,
  InputAudioBufferCommitEvent,
  RealtimeError,
  SessionUpdateEvent,
} from 'openai/resources/realtime/realtime';
import { PCM_RATE } from './pcm-player';

export const REALTIME_PATH = '/api/v1/realtime';

export type TurnDetectionMode = 'vad' | 'manual';
export type RealtimeOptions = { model: string; language: string; turnDetection: TurnDetectionMode };

/** Same-origin WebSocket URL; `wss:` whenever the page itself is served over HTTPS. */
export function realtimeUrl(loc: { protocol: string; host: string }): string {
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}${REALTIME_PATH}`;
}

/** `session.update` for a transcription session: PCM16 24 kHz in, server VAD or manual commits. */
export function buildSessionUpdate(o: RealtimeOptions): SessionUpdateEvent {
  return {
    type: 'session.update',
    session: {
      type: 'transcription',
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: PCM_RATE },
          transcription: { model: o.model, ...(o.language ? { language: o.language } : {}) },
          turn_detection: o.turnDetection === 'vad' ? { type: 'server_vad' } : null,
        },
      },
    },
  };
}

/** `input_audio_buffer.append` carrying base64 PCM16 LE. */
export function buildAppend(audioBase64: string): InputAudioBufferAppendEvent {
  return { type: 'input_audio_buffer.append', audio: audioBase64 };
}

/** `input_audio_buffer.commit` — ends the current turn in manual mode. */
export function buildCommit(): InputAudioBufferCommitEvent {
  return { type: 'input_audio_buffer.commit' };
}

const CODE_HINTS: Record<string, string> = {
  engine_busy: 'Engine STT sedang sibuk. Tunggu sebentar lalu coba lagi.',
  engine_unavailable: 'Engine STT tidak terdaftar di server. Cek /dev/engines.',
  engine_unloaded: 'Engine STT dihentikan karena RAM menipis atau idle. Mulai lagi sebentar lagi.',
  memory_pressure: 'RAM server penuh. Tunggu beberapa saat lalu coba lagi, atau cek /dev/engines.',
};

/** Indonesian text for a server `error` event: the server's own message, else a hint per code. */
export function realtimeErrorMessage(error: unknown): string {
  const err = (error && typeof error === 'object' ? error : {}) as Partial<RealtimeError>;
  if (err.message) return err.message;
  return (err?.code && CODE_HINTS[err.code]) || 'Server realtime melaporkan error. Coba lagi.';
}

const CLOSE_HINTS: Record<number, string> = {
  1008: 'Sesi ditolak server. Muat ulang halaman lalu login lagi.',
  1009: 'Pesan audio terlalu besar untuk server.',
  1011: 'Server realtime mengalami error internal. Cek Server Log lalu coba lagi.',
  1013: 'Engine STT sedang sibuk. Tunggu sebentar lalu mulai lagi.',
};

/** Shown when the socket never opened: the server rejects with HTTP before the upgrade. */
export const CONNECT_FAILED =
  'Gagal terhubung ke /api/v1/realtime: sesi login habis, RAM server penuh, atau batas sesi tercapai. Muat ulang halaman lalu coba lagi (cek /dev/engines bila berulang).';

/**
 * Readable reason for a close the user did not ask for. Browsers hide the HTTP status of a
 * rejected upgrade (it surfaces as 1006 before `open`), so that case gets one generic message.
 */
export function closeMessage(code: number, reason: string, wasOpen: boolean): string {
  if (!wasOpen) return CONNECT_FAILED;
  const hint = CLOSE_HINTS[code] ?? `Koneksi realtime terputus (kode ${code}). Mulai lagi.`;
  return reason ? `${hint} Detail: ${reason}` : hint;
}
