/** Multipart parsing + validation for POST /api/v1/audio/transcriptions (OpenAI field names). */
import { isSttModel, isTtsModel, STT_MODEL_ID } from './aliases';
import { v1Config } from './config';
import { v1Error, v1ModelNotFound } from './errors';

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

const bad = (message: string, param: string, code = 'invalid_value') =>
  v1Error(400, message, { code, param });

const tooLarge = () =>
  v1Error(
    413,
    `File audio melebihi batas unggah ${Math.round(v1Config.maxUploadBytes / 1024 / 1024)} MB.`,
    {
      code: 'file_too_large',
      param: 'file',
    },
  );

const text = (form: FormData, key: string): string | undefined => {
  const v = form.get(key);
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
};

/** Comma-separated terms ("Qwen, Supertonic") -> trimmed, de-duplicated list. */
export const splitTerms = (...values: (string | undefined)[]): string[] => [
  ...new Set(
    values.flatMap((v) =>
      (v ?? '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ),
];

/** Hotword caps: libcrispasr biases decoding with every term, so huge prompts only add latency. */
export const MAX_HOTWORDS = 50;
export const MAX_HOTWORD_CHARS = 1000;

function parseBool(v: string | undefined): boolean | null {
  if (v === undefined || v === 'false' || v === '0') return false;
  if (v === 'true' || v === '1') return true;
  return null;
}

/** Validated request fields, or an OpenAI-shaped 400/413 Response. */
export async function readTranscriptionForm(
  request: Request,
): Promise<TranscriptionInput | Response> {
  if (Number(request.headers.get('content-length') ?? 0) > v1Config.maxUploadBytes + 64 * 1024)
    return tooLarge();
  if (!request.headers.get('content-type')?.includes('multipart/form-data'))
    return bad('Body request harus multipart/form-data.', 'file', 'invalid_content_type');
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    // Parser detail is not shown to the caller; the 400 itself is the signal.
    return bad(
      'Body multipart tidak bisa dibaca. Kirim ulang sebagai multipart/form-data yang valid.',
      'file',
      'invalid_body',
    );
  }

  const file = form.get('file');
  if (!(file instanceof File))
    return bad('Parameter `file` wajib diisi.', 'file', 'missing_required_parameter');
  if (file.size > v1Config.maxUploadBytes) return tooLarge();
  if (file.size === 0) return bad('File audio kosong.', 'file', 'invalid_audio');

  const model = text(form, 'model');
  if (!model) return bad('Parameter `model` wajib diisi.', 'model', 'missing_required_parameter');
  if (isTtsModel(model))
    return bad(
      `Model '${model}' adalah model TTS dan tidak mendukung transkripsi. Pakai ${STT_MODEL_ID} atau whisper-1.`,
      'model',
    );
  if (!isSttModel(model)) return v1ModelNotFound(model);

  const responseFormat = (text(form, 'response_format') ?? 'json') as ResponseFormat;
  if (!RESPONSE_FORMATS.includes(responseFormat))
    return bad(
      `response_format harus salah satu dari ${RESPONSE_FORMATS.join(', ')}.`,
      'response_format',
    );

  const stream = parseBool(text(form, 'stream'));
  if (stream === null) return bad('stream harus true atau false.', 'stream');
  if (stream && !STREAMABLE.includes(responseFormat))
    return bad(
      `Streaming hanya didukung untuk response_format ${STREAMABLE.join(' atau ')}.`,
      'stream',
    );

  const language = text(form, 'language')?.toLowerCase();
  if (language && !/^[a-z]{2}$/.test(language))
    return bad('`language` harus kode ISO 639-1, mis. "id" atau "en".', 'language');

  const granularities = [
    ...form.getAll('timestamp_granularities[]'),
    ...form.getAll('timestamp_granularities'),
  ]
    .map(String)
    .map((g) => g.trim());
  const unknown = granularities.find((g) => !GRANULARITIES.includes(g));
  if (unknown !== undefined)
    return bad(
      `timestamp_granularities harus word atau segment, bukan '${unknown}'.`,
      'timestamp_granularities',
    );

  const hotwords = splitTerms(text(form, 'prompt'), text(form, 'keywords'));
  if (hotwords.length > MAX_HOTWORDS || hotwords.join('').length > MAX_HOTWORD_CHARS)
    return bad(
      `prompt + keywords maksimal ${MAX_HOTWORDS} istilah dan ${MAX_HOTWORD_CHARS} karakter. Kurangi daftar istilahnya.`,
      'keywords',
    );

  return {
    file,
    model,
    language,
    hotwords,
    wordTimestamps: granularities.includes('word'),
    responseFormat,
    stream,
  };
}
