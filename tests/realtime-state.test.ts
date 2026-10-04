/** Realtime reducer: server transcription events → ordered turns, VAD indicator, errors. */
import { describe, expect, test } from 'bun:test';
import {
  initialRealtimeState,
  type RealtimeAction,
  type RealtimeState,
  realtimeReducer,
} from '../app/lib/realtime-state';

const run = (actions: RealtimeAction[], from: RealtimeState = initialRealtimeState) =>
  actions.reduce(realtimeReducer, from);
const ev = (type: string, rest: Record<string, unknown> = {}) =>
  ({ type, event_id: `evt_${type}`, ...rest }) as RealtimeAction;

describe('realtimeReducer', () => {
  test('connection lifecycle and session readiness', () => {
    let s = run([{ type: 'local.connecting' }, { type: 'local.open' }]);
    expect(s.connection).toBe('open');
    expect(s.sessionReady).toBe(false);
    s = run([ev('session.created')], s);
    expect(s.sessionReady).toBe(true);
    expect(run([ev('session.updated')], { ...s, sessionReady: false }).sessionReady).toBe(true);
    s = run([{ type: 'local.closed', lost: true }], s);
    expect(s).toMatchObject({ connection: 'lost', sessionReady: false, speaking: false });
    expect(run([{ type: 'local.closed', lost: false }], s).connection).toBe('idle');
  });

  test('connecting resets previous turns and errors', () => {
    const dirty = {
      ...initialRealtimeState,
      lastError: 'x',
      turns: [{ itemId: 'a', status: 'done' as const, text: 't', error: null }],
    };
    expect(run([{ type: 'local.connecting' }], dirty)).toEqual({
      ...initialRealtimeState,
      connection: 'connecting',
    });
  });

  test('VAD turn: started → stopped → committed → deltas → completed', () => {
    let s = run([ev('input_audio_buffer.speech_started', { item_id: 'i1', audio_start_ms: 0 })]);
    expect(s.speaking).toBe(true);
    expect(s.turns).toEqual([{ itemId: 'i1', status: 'speaking', text: '', error: null }]);
    s = run(
      [
        ev('input_audio_buffer.speech_stopped', { item_id: 'i1', audio_end_ms: 900 }),
        ev('input_audio_buffer.committed', { item_id: 'i1', previous_item_id: null }),
      ],
      s,
    );
    expect(s.speaking).toBe(false);
    expect(s.turns[0].status).toBe('waiting');
    s = run(
      [
        ev('conversation.item.input_audio_transcription.delta', { item_id: 'i1', delta: 'Halo ' }),
        ev('conversation.item.input_audio_transcription.delta', { item_id: 'i1', delta: 'dunia' }),
      ],
      s,
    );
    expect(s.turns[0]).toMatchObject({ status: 'transcribing', text: 'Halo dunia' });
    s = run(
      [
        ev('conversation.item.input_audio_transcription.completed', {
          item_id: 'i1',
          transcript: 'Halo, dunia.',
          content_index: 0,
        }),
      ],
      s,
    );
    expect(s.turns[0]).toEqual({ itemId: 'i1', status: 'done', text: 'Halo, dunia.', error: null });
    // Late events never downgrade a finished turn.
    s = run(
      [
        ev('input_audio_buffer.committed', { item_id: 'i1' }),
        ev('conversation.item.input_audio_transcription.delta', { item_id: 'i1', delta: 'x' }),
      ],
      s,
    );
    expect(s.turns[0]).toMatchObject({ status: 'done', text: 'Halo, dunia.' });
  });

  test('turns stay in commit order even when completions arrive out of order', () => {
    const s = run([
      ev('input_audio_buffer.committed', { item_id: 'a', previous_item_id: null }),
      ev('input_audio_buffer.committed', { item_id: 'c', previous_item_id: 'a' }),
      ev('input_audio_buffer.committed', { item_id: 'b', previous_item_id: 'a' }),
      ev('conversation.item.input_audio_transcription.completed', {
        item_id: 'c',
        transcript: 'tiga',
      }),
      ev('conversation.item.input_audio_transcription.completed', {
        item_id: 'a',
        transcript: 'satu',
      }),
      ev('conversation.item.input_audio_transcription.delta', { item_id: 'z', delta: 'baru' }),
    ]);
    expect(s.turns.map((t) => t.itemId)).toEqual(['a', 'b', 'c', 'z']);
    expect(s.turns.map((t) => t.status)).toEqual(['done', 'waiting', 'done', 'transcribing']);
  });

  test('failed turn carries an Indonesian message; server error sets lastError', () => {
    let s = run([
      ev('input_audio_buffer.committed', { item_id: 'f' }),
      ev('conversation.item.input_audio_transcription.failed', {
        item_id: 'f',
        content_index: 0,
        error: { message: 'engine mati' },
      }),
    ]);
    expect(s.turns[0]).toMatchObject({
      status: 'failed',
      error: 'Transkripsi giliran ini gagal: engine mati',
    });
    s = run(
      [ev('conversation.item.input_audio_transcription.failed', { item_id: 'g', error: {} })],
      s,
    );
    expect(s.turns[1].error).toBe('Transkripsi giliran ini gagal. Coba ucapkan lagi.');
    s = run(
      [ev('error', { error: { type: 'server_error', code: 'memory_pressure', message: '' } })],
      s,
    );
    expect(s.lastError).toMatch(/RAM server penuh/);
  });

  test('unknown event types leave state untouched', () => {
    const s = run([ev('rate_limits.updated'), ev('input_audio_buffer.cleared')]);
    expect(s).toBe(initialRealtimeState);
  });
});
