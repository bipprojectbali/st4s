---
name: st4s-speech
description: Self-hosted speech API (Qwen3-ASR speech-to-text, Supertonic 3 text-to-speech) that speaks the OpenAI audio API at {{BASE_URL}}/api/v1. Use it to transcribe audio files or live microphone audio, or to synthesize speech, especially Indonesian (default language "id"). Triggers - transcribe, speech-to-text, STT, subtitles, text-to-speech, TTS, voice, Indonesian audio.
---

OpenAI-compatible: use the official openai SDK with base_url = {{BASE_URL}}/api/v1 and your API key.

# st4s speech API

## How it differs from OpenAI

- Models are local: `qwen3-asr-1.7b` (STT) and `supertonic-3` (TTS). OpenAI model names are accepted as aliases (table below).
- Missing `language` means the server default (normally Indonesian, `id`), **not** auto-detect. Send `language` for other languages.
- STT streaming yields one `transcript.text.delta` per voice-activity chunk (up to ~30 s of audio), not per token. Short clips get one delta.
- `transcript.text.done` has no `usage` (no token counting). `usage` is `{type:"duration", seconds}` and only in `json`/`verbose_json`.
- Extensions: `keywords` (STT hotwords), `language` and `steps` (TTS), `GET /api/v1/audio/voices`.
- Not supported: `POST /api/v1/audio/translations` (always `400 unsupported`), Realtime conversation sessions (only transcription sessions), auto language detection, `temperature`.

## Auth

- Send `Authorization: Bearer <API key>` (the SDK does this from `api_key`) or `X-API-Key: <API key>`. Keys look like `mk_live_…`.
- Scopes: `stt:transcribe` for transcriptions and the realtime WebSocket, `tts:speak` for speech. A key without the scope gets `403 missing_scope`.
- Public, no key: `GET /api/v1/models`, `GET /api/v1/models/:id`, `GET /api/v1/audio/voices`.
- Getting a key: any signed-in user creates a personal key on the `/profile` page (max 10 active, scopes limited to their role; both speech scopes are allowed for every role). Super-admins can also create keys for others at `/dev/api-keys`. The key value is shown once. Default expiry 90 days.
- A browser session cookie is also accepted (same origin), which is how the built-in playground works.

## Quickstart

curl:

```bash
export ST4S_API_KEY=mk_live_...   # your key
curl {{BASE_URL}}/api/v1/audio/transcriptions -H "Authorization: Bearer $ST4S_API_KEY" \
  -F file=@clip.wav -F model=whisper-1 -F language=id
curl {{BASE_URL}}/api/v1/audio/speech -H "Authorization: Bearer $ST4S_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"tts-1","voice":"alloy","input":"Selamat pagi.","response_format":"wav"}' -o pagi.wav
```

Python (`pip install openai`):

```python
import os
from openai import OpenAI
client = OpenAI(api_key=os.environ["ST4S_API_KEY"], base_url="{{BASE_URL}}/api/v1")
with open("clip.wav", "rb") as f:
    print(client.audio.transcriptions.create(model="whisper-1", file=f, language="id").text)
with client.audio.speech.with_streaming_response.create(
    model="tts-1", voice="alloy", input="Selamat pagi.", response_format="wav",
    extra_body={"language": "id"},  # st4s extension
) as res:
    res.stream_to_file("pagi.wav")
```

JavaScript (`npm i openai`):

```js
import fs from 'node:fs';
import OpenAI from 'openai';
const client = new OpenAI({ apiKey: process.env.ST4S_API_KEY, baseURL: '{{BASE_URL}}/api/v1' });
const tr = await client.audio.transcriptions.create({
  file: fs.createReadStream('clip.wav'), model: 'whisper-1', language: 'id',
});
console.log(tr.text);
const speech = await client.audio.speech.create({
  model: 'tts-1', voice: 'alloy', input: 'Selamat pagi.', response_format: 'wav',
});
fs.writeFileSync('pagi.wav', Buffer.from(await speech.arrayBuffer()));
```

## Models and voices

| Model | Kind | Accepted aliases |
|---|---|---|
| `qwen3-asr-1.7b` | STT | `whisper-1`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe` |
| `supertonic-3` | TTS | `tts-1`, `tts-1-hd`, `gpt-4o-mini-tts` |

- `GET /api/v1/models` → `{object:"list", data:[{id, object:"model", created, owned_by:"st4s"}]}` (aliases included). `GET /api/v1/models/:id` → one model or `404 model_not_found`. An unknown `model` on any endpoint is the same `404 model_not_found` (SDK `NotFoundError`), like api.openai.com.
- `GET /api/v1/audio/voices` → `{object:"list", data:[{id, object:"voice", voice}]}`; `voice` is the native voice an alias maps to.
- Native voices `F1`–`F5`, `M1`–`M5` (case-insensitive). OpenAI names map: alloy→F1, coral→F2, marin→F2, fable→F3, nova→F4, shimmer→F5, sage→F5, ash→M1, ballad→M2, echo→M3, onyx→M4, cedar→M4, verse→M5.

## POST /api/v1/audio/transcriptions

`multipart/form-data`, scope `stt:transcribe`.

| Field | Default | Notes |
|---|---|---|
| `file` | required | wav, flac, mp3, mp4, mpeg, mpga, m4a, ogg, webm. Max 25 MB upload, max 1800 s audio (operator-configurable). |
| `model` | required | STT model or alias. A TTS model → `400 invalid_value`; unknown → `404 model_not_found`. |
| `language` | server default (`id`) | ISO 639-1, two letters. |
| `response_format` | `json` | `json`, `text`, `srt`, `vtt`, `verbose_json`. |
| `timestamp_granularities[]` | `segment` | `segment` and/or `word` (words only in `verbose_json`). |
| `stream` | `false` | `true` only with `json`/`text`. |
| `prompt`, `keywords` | — | Hotwords for names/jargon; `keywords` is comma-separated. Together max 50 terms, 1000 chars. |

Responses:
- `json`: `{"text": "...", "usage": {"type": "duration", "seconds": 4}}` (seconds rounded up).
- `text`/`srt` → `text/plain`, `vtt` → `text/vtt`.
- `verbose_json`: `{task:"transcribe", language:"indonesian", duration, text, segments:[{id, seek, start, end, text, tokens, temperature, avg_logprob, compression_ratio, no_speech_prob}], words?:[{word, start, end}], usage}`. `language` is the lowercase English name, like whisper-1.
- `stream=true` → `text/event-stream`:
  ```
  data: {"type":"transcript.text.delta","delta":"Selamat pagi "}
  data: {"type":"transcript.text.done","text":"Selamat pagi semuanya."}
  ```
  Errors before the first delta come back as a normal JSON error response; after it as `data: {"type":"error","error":{message,type,param,code}}` and the stream ends.

## POST /api/v1/audio/speech

JSON body, scope `tts:speak`. Audio starts streaming after the first sentence group is synthesized.

| Field | Default | Notes |
|---|---|---|
| `model` | required | TTS model or alias. An STT model → `400 invalid_value`; unknown → `404 model_not_found`. |
| `input` | required | Max 4096 characters. |
| `voice` | required | Name (native or OpenAI alias) or `{"id": "F1"}`. |
| `response_format` | `mp3` | `mp3` (audio/mpeg), `opus` (audio/ogg), `aac`, `flac`, `wav`, `pcm` (raw 16-bit mono). Non-wav/pcm need ffmpeg on the server, else `400 unsupported_format`. |
| `speed` | `1` | 0.25–4. |
| `stream_format` | `audio` | `sse` → events `{"type":"speech.audio.delta","audio":"<base64>"}` then `{"type":"speech.audio.done","usage":{"input_tokens","output_tokens":0,"total_tokens"}}`. Not allowed with `tts-1`/`tts-1-hd` (OpenAI rule): use `gpt-4o-mini-tts`. |
| `language` | server default (`id`) | st4s extension: en, ko, ja, ar, bg, cs, da, de, el, es, et, fi, fr, hi, hr, hu, id, it, lt, lv, nl, pl, pt, ro, ru, sk, sl, sv, tr, uk, vi, na. |
| `steps` | server default (8) | st4s extension: denoising steps, clamped 1–20. More = slower, smoother. |

With the SDKs, pass extensions as `extra_body` (Python) or extra object keys (JS; cast if TypeScript complains).

## GET /api/v1/realtime (WebSocket, transcription only)

OpenAI Realtime GA protocol, transcription sessions only. URL `{{BASE_URL}}/api/v1/realtime` with `http`→`ws`, `https`→`wss`; `?intent=transcription` optional, any other intent gets an `error` event and close 1008.

Auth is checked on the HTTP upgrade request, before the socket opens: `Authorization: Bearer <key>` / `X-API-Key` with scope `stt:transcribe`, or a same-origin session cookie. There is **no** query-string or subprotocol key auth, so browser `new WebSocket()` cannot use an API key (it can't set headers): use a server-side client. Refusals are plain HTTP: `401 invalid_api_key`, `403 origin_not_allowed` (cookie from a foreign Origin), `426 upgrade_required`, `429 too_many_sessions` (default 2 concurrent), `429 rate_limit_exceeded` / `insufficient_quota` (key limits), `503 memory_pressure` / `engine_unavailable`.

The Node openai SDK works as is (`npm i openai ws`); it always dials `wss://`, so the server must be behind TLS:

```js
import { OpenAIRealtimeWS } from 'openai/realtime/ws';
const rt = new OpenAIRealtimeWS({ intent: 'transcription' }, client);
rt.on('conversation.item.input_audio_transcription.completed', (e) => console.log(e.transcript));
rt.socket.on('open', () => {
  rt.send({ type: 'session.update', session: { type: 'transcription', audio: { input: {
    format: { type: 'audio/pcm', rate: 24000 },
    transcription: { model: 'whisper-1', language: 'id' },
    turn_detection: { type: 'server_vad' },
  } } } });
  rt.send({ type: 'input_audio_buffer.append', audio: pcm16Base64 }); // ~100 ms chunks
});
```

Sequence:
1. Server sends `session.created` (session `{type:"transcription", object:"realtime.transcription_session", audio:{input:{format, transcription:{model, language, prompt}, turn_detection, noise_reduction:null}}}`).
2. Client may send `session.update` (`session.type` must be `transcription`) → `session.updated`. Fields: `audio.input.format` must be `{type:"audio/pcm", rate:24000}`; `transcription.model`, `language`, `prompt`, `keywords` (array); `turn_detection` = `{type:"server_vad", threshold 0.01–0.99 (0.5), prefix_padding_ms 0–5000 (300), silence_duration_ms 100–10000 (500)}` or `null` (manual). Default is `server_vad` when the server has a VAD model, else `null`.
3. Client streams `input_audio_buffer.append` `{audio: base64 PCM16 mono 24 kHz}` (frame max 2 MiB, larger → close 1009).
4. With `server_vad`: `input_audio_buffer.speech_started` → `speech_stopped` → `committed`. Manual: send `input_audio_buffer.commit` (≥100 ms of audio) → `committed`; `input_audio_buffer.clear` → `cleared`.
5. Per turn: `conversation.item.added`, one `conversation.item.input_audio_transcription.delta` (full turn text), then `…transcription.completed` `{item_id, content_index:0, transcript, usage:{type:"duration", seconds}}` or `…transcription.failed` `{error:{type, code, message}}`.

Errors are `{type:"error", event_id, error:{type, code, message, param, event_id}}`; the session stays open unless noted. Limits: session 1800 s (`session_expired`), idle 120 s without client events (`idle_timeout`), turn 60 s (VAD auto-commits; manual → `turn_too_long`, buffer cleared). Policy closes use 1008, emergency RAM 1013.

## Errors

Every HTTP error under `/api/v1` is `{"error": {"message", "type", "param", "code"}}` with header `x-request-id` (quote it when reporting). `type`: 400/413/415 `invalid_request_error`, 401 `authentication_error`, 403 `permission_error`, 404 `not_found_error` (except `model_not_found`: `invalid_request_error`, as OpenAI sends it), 429 `rate_limit_error`, others `server_error`. Messages are Indonesian; branch on `code`.

| Status | code | Meaning | Caller action |
|---|---|---|---|
| 400 | `invalid_value` | A parameter has a bad value (`param` names it), incl. a model of the wrong kind (TTS model for transcription or vice versa) | Fix the parameter |
| 400 | `missing_required_parameter` | `file` or `model` missing | Send it |
| 400 | `invalid_content_type` / `invalid_body` | Not multipart / unreadable form | Send `multipart/form-data` |
| 400 | `invalid_request` | Speech body is not a JSON object | Send a JSON object |
| 400 | `string_above_max_length` | `input` > 4096 chars | Split the text |
| 400 | `unsupported_value` | `stream_format:"sse"` with tts-1/tts-1-hd, or unknown TTS `language` | Use `gpt-4o-mini-tts` / a listed language |
| 400 | `unsupported_format` | Audio format can't be decoded, or no ffmpeg for that output | Send wav, or ask for `wav`/`pcm` |
| 400 | `invalid_audio` | Empty or corrupt audio | Check the file |
| 400 | `audio_too_long` | Over the duration limit (default 1800 s) | Split the audio |
| 400 | `request_aborted` | Client disconnected mid-request | Retry |
| 400 | `unsupported` | `/audio/translations` | Use transcriptions |
| 400 | `validation` / `parse` | Malformed request / body not parseable (e.g. invalid JSON) | Fix the request |
| 400 | `upgrade_failed` | WebSocket upgrade failed | Reconnect |
| 401 | `invalid_api_key` | No credential, or key unknown, expired, disabled, revoked or ownerless (the message says which) | Send a valid key / get a new one |
| 401 | `invalid_cookie_signature` | Tampered session cookie | Sign in again or use an API key |
| 403 | `missing_scope` | Key lacks `stt:transcribe` / `tts:speak` | Create a key with the scope |
| 403 | `role_too_low` / `owner_banned` / `ip_not_allowed` | Key owner or client IP not allowed | Ask the admin |
| 403 | `origin_not_allowed` | Realtime with session cookie from foreign Origin | Use an API key header |
| 404 | `not_found` | Unknown path or method | Check the URL |
| 404 | `model_not_found` | Unknown model id on any endpoint, incl. `GET /models/:id` (`param: "model"`); realtime sends the same code as an `error` event | Use a model from the table |
| 413 | `file_too_large` | Upload over limit (default 25 MB) | Compress or split |
| 415 | `invalid_file_type` | Upload type rejected by the framework | Send a supported audio type |
| 426 | `upgrade_required` | `/realtime` without WebSocket upgrade | Connect via WebSocket |
| 429 | `rate_limit_exceeded` | Per-IP rate limit (default 100 req/60 s) or per-key rate limit | Wait `Retry-After` |
| 429 | `insufficient_quota` | Key's usage quota is used up (the key is then deleted) | Get a new key / ask the admin |
| 429 | `engine_busy` | Engine queue full or decode slots busy | Wait `Retry-After`, retry |
| 429 | `too_many_sessions` | Realtime session limit | Retry after 10 s |
| 500 | `vad_failed` | Voice-activity model failed on this audio | Retry; report `x-request-id` |
| 500 | `tts_failed` / `server_error` | Synthesis or internal failure | Retry; report `x-request-id` |
| 503 | `engine_unloaded` | Engine was unloaded (idle/RAM) mid-job | Retry after `Retry-After` (5 s); next request reloads it |
| 503 | `engine_unavailable` | Engine failed to load or isn't installed | Retry later; operator must fix |
| 503 | `memory_pressure` | Server RAM low, new audio work refused | Wait `Retry-After` |
| 503 | `maintenance` | Maintenance mode | Retry later |

Realtime-only codes (in `error` events): `unsupported_session_type`, `unsupported_audio_format`, `unsupported_turn_detection`, `vad_unavailable` (server has no VAD; use `turn_detection: null`), `invalid_json`, `invalid_event`, `unsupported_event`, `input_audio_buffer_commit_empty`, `turn_too_long`, `idle_timeout`, `session_expired`; per-turn failures reuse `engine_busy`, `engine_unloaded`, `engine_unavailable`, `memory_pressure`, `vad_failed`, `server_error`.

## Operational notes

- Models load lazily: the first request after start or idle (10 min) waits for the load (several seconds for STT); warm engines answer at a few times real-time.
- Each engine runs one job at a time with a short queue (STT 4, TTS 8 by default); extra requests get `429 engine_busy`. Send STT requests sequentially, not in parallel.
- No server-side timeout on `/api/v1/audio/*` responses; set a generous client timeout (long audio ≈ half its duration or more). Disconnecting cancels the job at the next chunk.
- WAV (PCM 8/16/24/32-bit or float32) is decoded natively and is the fastest input; other formats go through ffmpeg. Audio is resampled to 16 kHz mono internally.
- Limits are operator-configurable; the numbers here are defaults. Privacy: the server logs only metrics, never transcripts, input text, or audio.
