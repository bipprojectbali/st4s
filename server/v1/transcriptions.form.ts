/** Multipart parsing + validation for POST /api/v1/audio/transcriptions (OpenAI field names). */
import { isSttModel } from './aliases';
import { v1Config } from './config';
import { v1Error } from './errors';

export const RESPONSE_FORMATS = ['json', 'text', 'srt', 'vtt', 'verbose_json'] as const;
export type ResponseFormat = (typeof RESPONSE_FORMATS)[number];
const STREAMABLE: readonly ResponseFormat[] = ['json', 'text'];
const GRANULARITIES = ['word', 'segment'];

export type TranscriptionInput = {
  file: File;
  model: string;
  language?: string;
  hotwords: string[];
  wordTimestamps: boolean;
  responseFormat: ResponseFormat;
  stream: boolean;
};

const bad = (message: string, param: string, code = 'invalid_value') => v1Error(400, message, { code, param });

const tooLarge = () =>
  v1Error(413, `Audio file exceeds the ${Math.round(v1Config.maxUploadBytes / 1024 / 1024)} MB upload limit.`, {
    code: 'file_too_large',
    param: 'file',
  });

const text = (form: FormData, key: string): string | undefined => {
  const v = form.get(key);
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
};

/** Comma-separated terms ("Qwen, Supertonic") -> trimmed, de-duplicated list. */
export const splitTerms = (...values: (string | undefined)[]): string[] => [
  ...new Set(values.flatMap((v) => (v ?? '').split(',').map((t) => t.trim()).filter(Boolean))),
];

function parseBool(v: string | undefined): boolean | null {
  if (v === undefined || v === 'false' || v === '0') return false;
  if (v === 'true' || v === '1') return true;
  return null;
}

/** Validated request fields, or an OpenAI-shaped 400/413 Response. */
export async function readTranscriptionForm(request: Request): Promise<TranscriptionInput | Response> {
  if (Number(request.headers.get('content-length') ?? 0) > v1Config.maxUploadBytes + 64 * 1024) return tooLarge();
  if (!request.headers.get('content-type')?.includes('multipart/form-data'))
    return bad('Request body must be multipart/form-data.', 'file', 'invalid_content_type');
  let form: FormData;
  try {
    form = await request.formData();
  } catch (err) {
    return bad(`Could not parse multipart body: ${(err as Error).message}`, 'file', 'invalid_body');
  }

  const file = form.get('file');
  if (!(file instanceof File)) return bad("Missing required parameter: 'file'.", 'file', 'missing_required_parameter');
  if (file.size > v1Config.maxUploadBytes) return tooLarge();
  if (file.size === 0) return bad('Audio file is empty.', 'file', 'invalid_audio');

  const model = text(form, 'model');
  if (!model) return bad("Missing required parameter: 'model'.", 'model', 'missing_required_parameter');
  if (!isSttModel(model)) return bad(`Model '${model}' does not support transcription.`, 'model', 'model_not_found');

  const responseFormat = (text(form, 'response_format') ?? 'json') as ResponseFormat;
  if (!RESPONSE_FORMATS.includes(responseFormat))
    return bad(`response_format must be one of ${RESPONSE_FORMATS.join(', ')}.`, 'response_format');

  const stream = parseBool(text(form, 'stream'));
  if (stream === null) return bad('stream must be true or false.', 'stream');
  if (stream && !STREAMABLE.includes(responseFormat))
    return bad(`Streaming is only supported with response_format ${STREAMABLE.join(' or ')}.`, 'stream');

  const language = text(form, 'language')?.toLowerCase();
  if (language && !/^[a-z]{2}$/.test(language))
    return bad('language must be an ISO-639-1 code such as "en" or "id".', 'language');

  const granularities = [...form.getAll('timestamp_granularities[]'), ...form.getAll('timestamp_granularities')]
    .map(String)
    .map((g) => g.trim());
  const unknown = granularities.find((g) => !GRANULARITIES.includes(g));
  if (unknown !== undefined)
    return bad(`timestamp_granularities must be word or segment, got '${unknown}'.`, 'timestamp_granularities');

  return {
    file,
    model,
    language,
    hotwords: splitTerms(text(form, 'prompt'), text(form, 'keywords')),
    wordTimestamps: granularities.includes('word'),
    responseFormat,
    stream,
  };
}
