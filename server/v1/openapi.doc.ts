/** Hand-written OpenAPI docs for /api/v1: route `detail`s plus the document root served at /api/v1/openapi.json. */
import type { DocumentDecoration } from 'elysia';
import { APP_VERSION } from '../app-info';
import { CONTENT_TYPES, NATIVE_FORMATS, SPEECH_FORMATS } from '../audio/encode';
import { TTS_LANGUAGES } from '../engines/tts/text';
import {
  NATIVE_VOICES,
  STT_MODEL_ALIASES,
  STT_MODEL_ID,
  TTS_MODEL_ALIASES,
  TTS_MODEL_ID,
  VOICE_ALIASES,
} from './aliases';
import { speechConfig } from './speech-config';
import { NO_SSE_MODELS, SPEED_MAX, SPEED_MIN } from './speech-params';
import {
  GRANULARITIES,
  MAX_HOTWORD_CHARS,
  MAX_HOTWORDS,
  RESPONSE_FORMATS,
  STREAMABLE,
} from './transcriptions.form';

export const STT_MODELS = [STT_MODEL_ID, ...STT_MODEL_ALIASES];
export const TTS_MODELS = [TTS_MODEL_ID, ...TTS_MODEL_ALIASES];
export const VOICE_IDS = [...NATIVE_VOICES, ...Object.keys(VOICE_ALIASES)];
export const REALTIME_INTENTS = ['transcription'];

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: object, example?: unknown) => ({
  'application/json': { schema, ...(example === undefined ? {} : { example }) },
});
const err = (description: string) => ({ description, content: json(ref('Error')) });

/** Bearer = API key `mk_live_…` or a Better Auth session token. */
const KEY: Record<string, string[]>[] = [{ bearerAuth: [] }];
/** Public reads: a key is optional (only tracked when sent). */
const KEY_OPTIONAL: Record<string, string[]>[] = [{ bearerAuth: [] }, {}];

const LIMITED = {
  429: err(
    'Terlalu banyak request (`rate_limit_exceeded`), kuota API key habis (`insufficient_quota`), atau antrean mesin penuh (`engine_busy`, dengan header `Retry-After`).',
  ),
  503: err(
    'Server maintenance (`maintenance`), tekanan memori (`memory_pressure`), atau mesin belum siap (`engine_unavailable`/`engine_unloaded`).',
  ),
};
const PROTECTED = {
  401: err('API key atau sesi tidak ada / tidak valid (`invalid_api_key`).'),
  403: err('API key tidak punya scope, IP tidak diizinkan, atau pemilik kunci diblokir.'),
  ...LIMITED,
};

const MODEL_EXAMPLE = {
  id: STT_MODEL_ID,
  object: 'model',
  created: 1_767_225_600,
  owned_by: 'st4s',
};

export const docs = {
  models: {
    tags: ['Models'],
    summary: 'Daftar model',
    description: 'Model STT dan TTS beserta alias kompatibel OpenAI. Publik; API key opsional.',
    security: KEY_OPTIONAL,
    responses: {
      200: {
        description: 'Daftar model.',
        content: json(
          {
            type: 'object',
            properties: { object: { const: 'list' }, data: { type: 'array', items: ref('Model') } },
          },
          { object: 'list', data: [MODEL_EXAMPLE] },
        ),
      },
      ...LIMITED,
    },
  },
  model: {
    tags: ['Models'],
    summary: 'Detail satu model',
    description: 'Publik; API key opsional.',
    security: KEY_OPTIONAL,
    responses: {
      200: { description: 'Model.', content: json(ref('Model'), MODEL_EXAMPLE) },
      404: err('Model tidak dikenal (`model_not_found`, param `model`).'),
      ...LIMITED,
    },
  },
  voices: {
    tags: ['Audio'],
    summary: 'Daftar suara TTS',
    description:
      'Ekstensi st4s. `id` dipakai di field `voice` pada /audio/speech; `voice` = gaya native yang dipetakan. Publik; API key opsional.',
    security: KEY_OPTIONAL,
    responses: {
      200: {
        description: 'Daftar suara.',
        content: json(
          {
            type: 'object',
            properties: {
              object: { const: 'list' },
              data: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', enum: VOICE_IDS },
                    object: { const: 'voice' },
                    voice: { type: 'string', enum: [...NATIVE_VOICES] },
                  },
                },
              },
            },
          },
          { object: 'list', data: [{ id: 'alloy', object: 'voice', voice: VOICE_ALIASES.alloy }] },
        ),
      },
      ...LIMITED,
    },
  },
  speech: {
    tags: ['Audio'],
    summary: 'Text-to-speech',
    description:
      'Kompatibel `POST /v1/audio/speech` OpenAI. Butuh scope `tts:speak` (atau sesi login).',
    security: KEY,
    requestBody: {
      required: true,
      content: json(
        {
          type: 'object',
          required: ['model', 'input', 'voice'],
          properties: {
            model: { type: 'string', enum: TTS_MODELS },
            input: { type: 'string', maxLength: speechConfig.maxInputChars },
            voice: {
              description:
                'Id suara (tidak peka huruf besar/kecil) atau `{ id }`. Lihat GET /api/v1/audio/voices.',
              oneOf: [
                { type: 'string', enum: VOICE_IDS },
                {
                  type: 'object',
                  required: ['id'],
                  properties: { id: { type: 'string', enum: VOICE_IDS } },
                },
              ],
            },
            response_format: {
              type: 'string',
              enum: [...SPEECH_FORMATS],
              default: 'mp3',
              description: `Selain ${NATIVE_FORMATS.join('/')} butuh ffmpeg di server; tanpa ffmpeg → 400 \`unsupported_format\`.`,
            },
            speed: { type: 'number', minimum: SPEED_MIN, maximum: SPEED_MAX, default: 1 },
            stream_format: {
              type: 'string',
              enum: ['audio', 'sse'],
              default: 'audio',
              description: `\`sse\` tidak didukung untuk ${NO_SSE_MODELS.join(', ')}.`,
            },
            language: {
              type: 'string',
              enum: [...TTS_LANGUAGES],
              default: speechConfig.defaultLanguage,
            },
            steps: {
              type: 'integer',
              minimum: speechConfig.stepsMin,
              maximum: speechConfig.stepsMax,
              description: 'Ekstensi st4s: langkah denoising, di-clamp ke rentang ini.',
            },
          },
        },
        { model: TTS_MODEL_ID, input: 'Halo, apa kabar?', voice: 'alloy', response_format: 'wav' },
      ),
    },
    responses: {
      200: {
        description:
          'Audio sesuai `response_format`, atau `text/event-stream` bila `stream_format=sse`.',
        content: Object.fromEntries([
          ...[...new Set(Object.values(CONTENT_TYPES))].map((type) => [
            type,
            { schema: { type: 'string', format: 'binary' } },
          ]),
          ['text/event-stream', { schema: { type: 'string' } }],
        ]),
      },
      400: err(
        'Parameter tidak valid (`param` menunjuk field-nya), mis. `unsupported_format`, `string_above_max_length`.',
      ),
      404: err('Model tidak dikenal (`model_not_found`).'),
      500: err('Sintesis gagal (`tts_failed`).'),
      ...PROTECTED,
    },
  },
  transcriptions: {
    tags: ['Audio'],
    summary: 'Speech-to-text',
    description:
      'Kompatibel `POST /v1/audio/transcriptions` OpenAI. Butuh scope `stt:transcribe` (atau sesi login). Upload melebihi batas (`V1_MAX_UPLOAD_MB`, default 25 MB) ditolak 413 sebelum body dibaca.',
    security: KEY,
    requestBody: {
      required: true,
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            required: ['file', 'model'],
            properties: {
              file: { type: 'string', format: 'binary' },
              model: { type: 'string', enum: STT_MODELS },
              response_format: { type: 'string', enum: [...RESPONSE_FORMATS], default: 'json' },
              stream: {
                type: 'boolean',
                default: false,
                description: `SSE; hanya untuk response_format ${STREAMABLE.join('/')}.`,
              },
              language: { type: 'string', pattern: '^[a-z]{2}$', description: 'Kode ISO 639-1.' },
              'timestamp_granularities[]': {
                type: 'array',
                items: { type: 'string', enum: GRANULARITIES },
                description: 'Untuk `verbose_json`.',
              },
              prompt: { type: 'string', description: 'Dipakai sebagai hotword (dipisah koma).' },
              keywords: {
                type: 'string',
                description: `Ekstensi st4s: hotword dipisah koma. prompt + keywords maks ${MAX_HOTWORDS} istilah / ${MAX_HOTWORD_CHARS} karakter.`,
              },
            },
          },
          example: {
            file: '(audio.wav)',
            model: STT_MODEL_ID,
            language: 'id',
            response_format: 'json',
          },
        },
      },
    },
    responses: {
      200: {
        description:
          'Transkrip sesuai `response_format` (`text`/`srt` → text/plain, `vtt` → text/vtt); `stream=true` → SSE `transcript.text.delta` / `transcript.text.done`.',
        content: {
          ...json(
            { oneOf: [ref('Transcription'), ref('TranscriptionVerbose')] },
            { text: 'Halo dunia.', usage: { type: 'duration', seconds: 1 } },
          ),
          'text/plain': { schema: { type: 'string' } },
          'text/vtt': { schema: { type: 'string' } },
          'text/event-stream': { schema: { type: 'string' } },
        },
      },
      400: err(
        'Form tidak valid, audio tidak bisa didecode, atau terlalu panjang (`audio_too_long`).',
      ),
      404: err('Model tidak dikenal (`model_not_found`).'),
      413: err('File melebihi batas upload (`file_too_large`).'),
      500: err('Transkripsi gagal (`vad_failed` / `server_error`).'),
      ...PROTECTED,
    },
  },
  translations: {
    tags: ['Audio'],
    summary: 'Terjemahan audio (tidak didukung)',
    description: 'Selalu 400 `unsupported`; pakai /api/v1/audio/transcriptions.',
    security: KEY,
    responses: { 400: err('Tidak didukung (`unsupported`).'), ...PROTECTED },
  },
  realtime: {
    tags: ['Realtime'],
    summary: 'Transkripsi realtime (WebSocket)',
    description:
      'Upgrade WebSocket (`GET` + `Upgrade: websocket`, subprotocol opsional `realtime`). Event mengikuti Realtime API OpenAI untuk sesi transkripsi: klien `session.update`, `input_audio_buffer.append|commit|clear`; server `session.created|updated`, `input_audio_buffer.*`, `conversation.item.input_audio_transcription.delta|completed|failed`, `error`. Butuh scope `stt:transcribe` (atau sesi login).',
    security: KEY,
    parameters: [
      {
        name: 'intent',
        in: 'query',
        required: false,
        schema: { type: 'string', enum: REALTIME_INTENTS },
        example: 'transcription',
      },
    ],
    responses: {
      101: { description: 'Switching Protocols — sesi WebSocket dimulai.' },
      400: err('Upgrade gagal (`upgrade_failed`).'),
      426: err('Bukan request upgrade WebSocket (`upgrade_required`).'),
      ...PROTECTED,
      403: err('Origin tidak diizinkan (`origin_not_allowed`), atau API key tidak punya scope.'),
      429: err('Sesi realtime penuh (`too_many_sessions`) atau rate limit.'),
    },
  },
} satisfies Record<string, DocumentDecoration>;

/** Document root merged over the generated paths by @elysia/openapi. */
export const openApiDocumentation = {
  info: {
    title: 'st4s API',
    version: APP_VERSION,
    description:
      'API suara st4s yang kompatibel OpenAI (base URL `/api/v1`): speech-to-text, text-to-speech, dan transkripsi realtime. Autentikasi: `Authorization: Bearer <API key>`. Error berbentuk `{ error: { message, type, param, code } }`.',
  },
  servers: [{ url: '/' }],
  tags: [{ name: 'Models' }, { name: 'Audio' }, { name: 'Realtime' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http' as const, scheme: 'bearer', description: 'API key `mk_live_…`.' },
    },
    schemas: {
      Error: {
        type: 'object' as const,
        required: ['error'],
        properties: {
          error: {
            type: 'object' as const,
            required: ['message', 'type', 'param', 'code'],
            properties: {
              message: { type: 'string' as const },
              type: { type: 'string' as const },
              param: { type: ['string', 'null'] as ('string' | 'null')[] },
              code: { type: ['string', 'null'] as ('string' | 'null')[] },
            },
          },
        },
      },
      Model: {
        type: 'object' as const,
        properties: {
          id: { type: 'string' as const, enum: [...STT_MODELS, ...TTS_MODELS] },
          object: { const: 'model' },
          created: { type: 'integer' as const },
          owned_by: { type: 'string' as const },
        },
      },
      Transcription: {
        type: 'object' as const,
        properties: {
          text: { type: 'string' as const },
          usage: {
            type: 'object' as const,
            properties: { type: { const: 'duration' }, seconds: { type: 'number' as const } },
          },
        },
      },
      TranscriptionVerbose: {
        type: 'object' as const,
        description: '`response_format=verbose_json`; `language` = nama Inggris huruf kecil.',
        properties: {
          task: { const: 'transcribe' },
          language: { type: 'string' as const },
          duration: { type: 'number' as const },
          text: { type: 'string' as const },
          segments: { type: 'array' as const, items: { type: 'object' as const } },
          words: { type: 'array' as const, items: { type: 'object' as const } },
          usage: { type: 'object' as const },
        },
      },
    },
  },
};
