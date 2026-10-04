/** GET /api/v1/models, /api/v1/models/:id and /api/v1/audio/voices (public reads). */
import { Elysia } from 'elysia';
import {
  NATIVE_VOICES,
  STT_MODEL_ALIASES,
  STT_MODEL_ID,
  TTS_MODEL_ALIASES,
  TTS_MODEL_ID,
  VOICE_ALIASES,
} from './aliases';
import { v1ModelNotFound } from './errors';

/** Fixed `created` timestamp for every model (2026-01-01T00:00:00Z); the ids never change at runtime. */
const MODELS_CREATED = 1_767_225_600;

const MODEL_IDS = [STT_MODEL_ID, ...STT_MODEL_ALIASES, TTS_MODEL_ID, ...TTS_MODEL_ALIASES];

const model = (id: string) => ({
  id,
  object: 'model' as const,
  created: MODELS_CREATED,
  owned_by: 'st4s',
});

/** st4s extension: `{ object:'list', data:[{ id, object:'voice', voice }] }` where `voice` is the native style an id maps to. */
function voiceList() {
  const native = NATIVE_VOICES.map((id) => ({ id, object: 'voice' as const, voice: id }));
  const aliases = Object.entries(VOICE_ALIASES).map(([id, voice]) => ({
    id,
    object: 'voice' as const,
    voice,
  }));
  return { object: 'list' as const, data: [...native, ...aliases] };
}

export const modelsApi = new Elysia()
  .get('/models', () => ({ object: 'list' as const, data: MODEL_IDS.map(model) }))
  .get('/models/:id', ({ params }) =>
    MODEL_IDS.includes(params.id) ? model(params.id) : v1ModelNotFound(params.id),
  )
  .get('/audio/voices', voiceList);
