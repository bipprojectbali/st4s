/** OpenAI Realtime (GA) wire format for transcription sessions: event builders and client event validation. */
import { isSttModel, STT_MODEL_ID } from './aliases';
import { MAX_HOTWORD_CHARS, MAX_HOTWORDS, splitTerms } from './transcriptions.form';

/** server_vad tuning; OpenAI defaults are 0.5 / 300 / 500. */
export type ServerVad = {
  type: 'server_vad';
  threshold: number;
  prefix_padding_ms: number;
  silence_duration_ms: number;
};

/** Effective session settings. */
export type RtSessionConfig = {
  model: string;
  language: string | null;
  prompt: string | null;
  keywords: string[];
  turnDetection: ServerVad | null;
};

/** A protocol problem reported as an `error` event (the session stays open unless the caller closes it). */
export type RtProblem = { message: string; code: string; param?: string };

export const VAD_DEFAULTS: ServerVad = {
  type: 'server_vad',
  threshold: 0.5,
  prefix_padding_ms: 300,
  silence_duration_ms: 500,
};

const rid = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;

/** Fresh id with an OpenAI-style prefix (event, item, sess). */
export const newId = rid;

/** A server event with its own event_id. */
export function serverEvent(type: string, fields: Record<string, unknown> = {}) {
  return { event_id: rid('event'), type, ...fields };
}

/** An `error` event; `clientEventId` points at the client event that caused it. */
export function errorEvent(
  p: RtProblem,
  clientEventId?: string | null,
  type = 'invalid_request_error',
) {
  return serverEvent('error', {
    error: {
      type,
      code: p.code,
      message: p.message,
      param: p.param ?? null,
      event_id: clientEventId ?? null,
    },
  });
}

/** Default settings for a new session. */
export function defaultSessionConfig(vadAvailable: boolean): RtSessionConfig {
  return {
    model: STT_MODEL_ID,
    language: null,
    prompt: null,
    keywords: [],
    turnDetection: vadAvailable ? { ...VAD_DEFAULTS } : null,
  };
}

/** Session object for session.created / session.updated. */
export function sessionView(id: string, c: RtSessionConfig) {
  return {
    type: 'transcription',
    object: 'realtime.transcription_session',
    id,
    audio: {
      input: {
        format: { type: 'audio/pcm', rate: 24_000 },
        transcription: { model: c.model, language: c.language, prompt: c.prompt ?? '' },
        turn_detection: c.turnDetection,
        noise_reduction: null,
      },
    },
    include: [],
  };
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const problem = (message: string, param: string, code = 'invalid_value'): RtProblem => ({
  message,
  code,
  param,
});

function rangeOr(
  v: unknown,
  def: number,
  min: number,
  max: number,
  param: string,
): number | RtProblem {
  if (v === undefined || v === null) return def;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
    return problem(`${param} harus angka antara ${min} dan ${max}.`, param);
  return v;
}

function parseTurnDetection(td: unknown, vadAvailable: boolean): ServerVad | null | RtProblem {
  const p = 'session.audio.input.turn_detection';
  if (td === null) return null;
  if (!isObj(td) || td.type !== 'server_vad')
    return problem(
      'turn_detection hanya mendukung {"type":"server_vad"} atau null.',
      `${p}.type`,
      'unsupported_turn_detection',
    );
  if (!vadAvailable)
    return problem(
      'server_vad tidak tersedia di server ini (model Silero VAD tidak ada). Pakai turn_detection null dan commit manual.',
      p,
      'vad_unavailable',
    );
  const threshold = rangeOr(td.threshold, VAD_DEFAULTS.threshold, 0.01, 0.99, `${p}.threshold`);
  if (typeof threshold !== 'number') return threshold;
  const prefix = rangeOr(
    td.prefix_padding_ms,
    VAD_DEFAULTS.prefix_padding_ms,
    0,
    5_000,
    `${p}.prefix_padding_ms`,
  );
  if (typeof prefix !== 'number') return prefix;
  const silence = rangeOr(
    td.silence_duration_ms,
    VAD_DEFAULTS.silence_duration_ms,
    100,
    10_000,
    `${p}.silence_duration_ms`,
  );
  if (typeof silence !== 'number') return silence;
  return { type: 'server_vad', threshold, prefix_padding_ms: prefix, silence_duration_ms: silence };
}

/** Merge a session.update payload onto `cur`; unknown fields are ignored like OpenAI's optional ones. */
export function applySessionUpdate(
  cur: RtSessionConfig,
  s: unknown,
  vadAvailable: boolean,
): RtSessionConfig | RtProblem {
  if (!isObj(s)) return problem('session harus objek.', 'session');
  if (s.type !== 'transcription')
    return problem(
      'Server ini hanya mendukung sesi transkripsi (session.type "transcription"); sesi percakapan/response tidak didukung.',
      'session.type',
      'unsupported_session_type',
    );
  const next: RtSessionConfig = { ...cur };
  const input = isObj(s.audio) && isObj(s.audio.input) ? s.audio.input : {};
  if (input.format !== undefined) {
    const f = input.format;
    if (!isObj(f) || f.type !== 'audio/pcm' || (f.rate !== undefined && f.rate !== 24_000))
      return problem(
        'Format audio harus {"type":"audio/pcm","rate":24000} (PCM16 mono 24 kHz).',
        'session.audio.input.format',
        'unsupported_audio_format',
      );
  }
  if (input.transcription !== undefined && input.transcription !== null) {
    const t = input.transcription;
    if (!isObj(t))
      return problem('transcription harus objek.', 'session.audio.input.transcription');
    if (t.model !== undefined) {
      if (typeof t.model !== 'string' || !isSttModel(t.model))
        return problem(
          `Model '${String(t.model)}' tidak dikenal. Pakai ${STT_MODEL_ID} atau whisper-1.`,
          'session.audio.input.transcription.model',
          'model_not_found',
        );
      next.model = t.model;
    }
    if (t.language !== undefined) {
      const lang = typeof t.language === 'string' ? t.language.toLowerCase() : t.language;
      if (lang !== null && lang !== '' && (typeof lang !== 'string' || !/^[a-z]{2}$/.test(lang)))
        return problem(
          '`language` harus kode ISO 639-1, mis. "id" atau "en".',
          'session.audio.input.transcription.language',
        );
      next.language = lang || null;
    }
    if (t.prompt !== undefined) {
      if (t.prompt !== null && typeof t.prompt !== 'string')
        return problem('prompt harus teks.', 'session.audio.input.transcription.prompt');
      next.prompt = t.prompt || null;
    }
    if (t.keywords !== undefined) {
      if (!Array.isArray(t.keywords) || !t.keywords.every((k) => typeof k === 'string'))
        return problem('keywords harus daftar teks.', 'session.audio.input.transcription.keywords');
      next.keywords = t.keywords;
    }
    const terms = hotwordsOf(next);
    if (terms.length > MAX_HOTWORDS || terms.join('').length > MAX_HOTWORD_CHARS)
      return problem(
        `prompt + keywords maksimal ${MAX_HOTWORDS} istilah dan ${MAX_HOTWORD_CHARS} karakter.`,
        'session.audio.input.transcription.keywords',
      );
  }
  if (input.turn_detection !== undefined) {
    const td = parseTurnDetection(input.turn_detection, vadAvailable);
    if (td && 'code' in td) return td;
    next.turnDetection = td;
  }
  return next;
}

/** Hotwords passed to the engine (same splitting as the HTTP route's prompt + keywords). */
export function hotwordsOf(c: RtSessionConfig): string[] {
  return splitTerms(c.prompt ?? undefined, c.keywords.join(','));
}

/** A parsed client event, or the problem with it. */
export type ClientEvent = { type: string; event_id?: string } & Record<string, unknown>;

/** Parse one text frame; binary frames and non-objects are protocol errors. */
export function parseClientEvent(raw: string | Buffer): ClientEvent | RtProblem {
  if (typeof raw !== 'string')
    return { message: 'Kirim event sebagai teks JSON, bukan frame biner.', code: 'invalid_event' };
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return { message: 'Event bukan JSON yang valid.', code: 'invalid_json' };
  }
  if (!isObj(v) || typeof v.type !== 'string')
    return {
      message: 'Event harus objek JSON dengan field "type".',
      code: 'invalid_event',
      param: 'type',
    };
  return v as ClientEvent;
}
