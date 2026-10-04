/** Playground stream helpers: SSE split across chunks, OpenAI error events, PCM16 carry-over. */
import { describe, expect, test } from 'bun:test';
import { base64ToBytes, s16leToFloat } from '../app/lib/pcm-player';
import { createSseParser, sseErrorMessage } from '../app/lib/playground-sse';

describe('createSseParser', () => {
  test('joins events split across chunks and ignores non-data lines', () => {
    const got: unknown[] = [];
    const feed = createSseParser((e) => got.push(e));
    feed(': ping\n\ndata: {"type":"transcript.text.delta","del');
    feed('ta":"Ha"}\n\nevent: x\ndata: {"type":"transcript.text.done","text":"Halo"}\n');
    feed('\ndata: [DONE]\n\n');
    expect(got).toEqual([
      { type: 'transcript.text.delta', delta: 'Ha' },
      { type: 'transcript.text.done', text: 'Halo' },
    ]);
  });
  test('reads the message from an OpenAI-shaped error event only', () => {
    expect(sseErrorMessage({ error: { message: 'boom', type: 'server_error' } })).toBe('boom');
    expect(sseErrorMessage({ type: 'speech.audio.delta', audio: 'AA==' })).toBeNull();
  });
});

describe('s16leToFloat', () => {
  test('decodes little-endian samples and carries an odd trailing byte', () => {
    const bytes = base64ToBytes(Buffer.from([0x00, 0x40, 0x00, 0x80, 0x7f]).toString('base64'));
    const { samples, rest } = s16leToFloat(bytes);
    expect([...samples]).toEqual([0.5, -1]);
    expect([...rest]).toEqual([0x7f]);
  });
});
