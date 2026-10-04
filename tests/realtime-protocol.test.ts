/** Realtime client events are SDK-shaped; error/close/mic failures map to actionable Indonesian text. */
import { describe, expect, test } from 'bun:test';
import { micErrorMessage } from '../app/lib/realtime-mic';
import {
  buildAppend,
  buildCommit,
  buildSessionUpdate,
  CONNECT_FAILED,
  closeMessage,
  realtimeErrorMessage,
  realtimeUrl,
} from '../app/lib/realtime-protocol';

describe('client events', () => {
  test('session.update for VAD transcription with PCM 24 kHz', () => {
    expect(
      buildSessionUpdate({ model: 'qwen3-asr-1.7b', language: 'id', turnDetection: 'vad' }),
    ).toEqual({
      type: 'session.update',
      session: {
        type: 'transcription',
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: 24000 },
            transcription: { model: 'qwen3-asr-1.7b', language: 'id' },
            turn_detection: { type: 'server_vad' },
          },
        },
      },
    });
  });

  test('manual mode disables turn detection; empty language is omitted', () => {
    const e = buildSessionUpdate({ model: 'whisper-1', language: '', turnDetection: 'manual' });
    expect(e.session).toMatchObject({
      audio: { input: { turn_detection: null, transcription: { model: 'whisper-1' } } },
    });
    expect(JSON.stringify(e)).not.toContain('language');
  });

  test('append and commit', () => {
    expect(buildAppend('AAA=')).toEqual({ type: 'input_audio_buffer.append', audio: 'AAA=' });
    expect(buildCommit()).toEqual({ type: 'input_audio_buffer.commit' });
  });

  test('URL follows page protocol and host', () => {
    expect(realtimeUrl({ protocol: 'http:', host: 'localhost:3000' })).toBe(
      'ws://localhost:3000/api/v1/realtime',
    );
    expect(realtimeUrl({ protocol: 'https:', host: 'stt.example.com' })).toBe(
      'wss://stt.example.com/api/v1/realtime',
    );
  });
});

describe('readable failures', () => {
  test('server error: own message first, code hint second, generic last', () => {
    expect(realtimeErrorMessage({ message: 'Antrean penuh', code: 'engine_busy' })).toBe(
      'Antrean penuh',
    );
    expect(realtimeErrorMessage({ code: 'memory_pressure' })).toMatch(/RAM server penuh/);
    expect(realtimeErrorMessage(undefined)).toMatch(/Server realtime melaporkan error/);
  });

  test('close codes: refused before open is generic, known codes after open get hints', () => {
    expect(closeMessage(1006, '', false)).toBe(CONNECT_FAILED);
    expect(closeMessage(1008, 'x', false)).toBe(CONNECT_FAILED);
    expect(CONNECT_FAILED).toMatch(/sesi login habis, RAM server penuh, atau batas sesi/);
    expect(closeMessage(1008, '', true)).toMatch(/login lagi\.$/);
    expect(closeMessage(1006, '', true)).toBe('Koneksi realtime terputus (kode 1006). Mulai lagi.');
    expect(closeMessage(1013, 'busy', true)).toMatch(/sibuk\. .*Detail: busy$/);
  });

  test('mic errors by DOMException name', () => {
    const err = (name: string) => Object.assign(new Error('x'), { name });
    expect(micErrorMessage(err('NotAllowedError'))).toMatch(/Izin mikrofon ditolak/);
    expect(micErrorMessage(err('NotFoundError'))).toMatch(/tidak ditemukan/);
    expect(micErrorMessage(err('NotReadableError'))).toMatch(/dipakai aplikasi lain/);
    expect(micErrorMessage(new Error('boom'))).toBe('Mikrofon tidak bisa dipakai: boom');
  });
});
