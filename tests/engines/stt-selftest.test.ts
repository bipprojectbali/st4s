import { describe, expect, test } from 'bun:test';
import { EngineNotReadyError } from '../../server/engines/errors';
import { createSttEngine } from '../../server/engines/stt';
import type { SttSpawner } from '../../server/engines/stt/host';
import type { FromChild, ToChild } from '../../server/engines/stt/protocol';
import {
  normaliseWords,
  SELFTEST_MIN_OVERLAP,
  SELFTEST_TEXT,
  wordOverlap,
} from '../../server/engines/stt/selftest';
import { selfTestEnabled } from '../../server/engines/stt/selftest-env';

/** How the fake child answers self-test probes (negative ids); jobs (positive ids) get 'job ok'. */
type Behaviour = {
  vad?: [number, number][] | 'error';
  silence?: string;
  clip?: string;
};

type Fake = { sent: ToChild[]; killed: boolean };

function fakeSpawner(b: Behaviour = {}) {
  const children: Fake[] = [];
  const spawn: SttSpawner = (_cfg, on) => {
    const c: Fake = { sent: [], killed: false };
    children.push(c);
    const reply = (m: FromChild) => queueMicrotask(() => on.message(m));
    reply({ t: 'ready', loadMs: 1, rss: 1000, backend: 'fake', gpu: false });
    return {
      send: (m) => {
        c.sent.push(m);
        if (m.t === 'vad')
          reply(
            b.vad === 'error'
              ? { t: 'vad_error', id: m.id, message: 'crispasr_vad_slices failed' }
              : { t: 'vad_result', id: m.id, spans: b.vad ?? [[0.3, 2.3]] },
          );
        if (m.t !== 'transcribe') return;
        const silent = m.audio.length === 16_000 && m.audio.every((x) => x === 0);
        const text =
          m.id > 0 ? 'job ok' : silent ? (b.silence ?? '') : (b.clip ?? `${SELFTEST_TEXT}.`);
        const result = { text, language: m.language, duration: 1, segments: [] };
        reply({ t: 'result', id: m.id, result, rss: 2000 });
      },
      kill: () => {
        c.killed = true;
        queueMicrotask(() => on.exit(null, 'SIGTERM'));
      },
    };
  };
  return { spawn, children };
}

const make = (b: Behaviour, config = {}) => {
  const f = fakeSpawner(b);
  const eng = createSttEngine({
    spawn: f.spawn,
    selfTest: true,
    config: { idleTimeoutSec: 0, vadModelPath: '/fake/silero.bin', ...config },
  });
  return { f, eng };
};

const audio = () => new Float32Array(16_000);

async function expectRefused(b: Behaviour, check: string, hint: string) {
  const { f, eng } = make(b);
  const err = await eng.warmup().catch((e: unknown) => e);
  expect(err).toBeInstanceOf(EngineNotReadyError);
  expect((err as Error).message).toContain('gagal dimuat');
  const s = eng.status();
  expect(s.state).toBe('error');
  expect(s.lastError).toContain(`(${check})`);
  expect(s.lastError).toContain(hint);
  expect(f.children[0]?.killed).toBe(true);
  return s.lastError ?? '';
}

describe('stt self-test scoring', () => {
  test('normaliseWords lowercases and drops punctuation', () => {
    expect(normaliseWords('Ask, what YOU can do — for your country!')).toEqual([
      'ask',
      'what',
      'you',
      'can',
      'do',
      'for',
      'your',
      'country',
    ]);
  });

  test('wordOverlap: exact, partial, garbage, extra words', () => {
    expect(wordOverlap(SELFTEST_TEXT, 'Ask what you can do for your country.')).toBe(1);
    expect(wordOverlap(SELFTEST_TEXT, 'asked what you could do for your country')).toBe(6 / 8);
    expect(wordOverlap(SELFTEST_TEXT, 'okay.')).toBe(0);
    expect(wordOverlap(SELFTEST_TEXT, '')).toBe(0);
    // Repeating one word cannot buy matches.
    expect(wordOverlap(SELFTEST_TEXT, 'your your your your')).toBe(1 / 8);
    // A correct transcript buried in hallucinated padding is penalised.
    const padded = `${SELFTEST_TEXT} ${'la '.repeat(12)}`;
    expect(wordOverlap(SELFTEST_TEXT, padded)).toBeLessThan(SELFTEST_MIN_OVERLAP);
  });

  test('ENGINE_SELFTEST: on by default, 0 disables, injected spawners opt out', () => {
    expect(selfTestEnabled(false, {})).toBe(true);
    expect(selfTestEnabled(false, { ENGINE_SELFTEST: '1' })).toBe(true);
    expect(selfTestEnabled(false, { ENGINE_SELFTEST: '0' })).toBe(false);
    expect(selfTestEnabled(true, { ENGINE_SELFTEST: '1' })).toBe(false);
  });
});

describe('stt engine self-test (fake child)', () => {
  test('passing self-test → ready; probes use negative ids, jobs still start at 1', async () => {
    const { f, eng } = make({});
    await eng.warmup();
    expect(eng.status().state).toBe('ready');
    expect(eng.status().lastError).toBeNull();
    const [c] = f.children;
    if (!c) throw new Error('fake child was never spawned');
    expect(c.sent.map((m) => [m.t, m.id])).toEqual([
      ['vad', -1],
      ['transcribe', -2],
      ['transcribe', -3],
    ]);
    const r = await eng.transcribe({ audio: audio() });
    expect(r.text).toBe('job ok');
    expect(c.sent.at(-1)).toMatchObject({ t: 'transcribe', id: 1 });
  });

  test('a job queued during load waits for the self-test', async () => {
    const { eng } = make({});
    const p = eng.transcribe({ audio: audio() });
    expect(eng.status().state).toBe('loading');
    expect((await p).text).toBe('job ok');
  });

  test('VAD hears nothing in the clip → error naming vad_speech and STT_VAD_MODEL', async () => {
    await expectRefused({ vad: [] }, 'vad_speech', 'STT_VAD_MODEL');
  });

  test('VAD errors (e.g. model failed to load) → error', async () => {
    await expectRefused({ vad: 'error' }, 'vad_speech', 'engine error');
  });

  test('silence transcribed as text → error naming silence_empty', async () => {
    await expectRefused({ silence: 'okay.' }, 'silence_empty', 'hening 1 detik');
  });

  test('clip transcript mismatch → error with the overlap score', async () => {
    const msg = await expectRefused(
      { clip: 'dan seterusnya' },
      'clip_overlap',
      'kecocokan 0% < 60%',
    );
    expect(msg).toContain('STT_MODEL');
    expect(msg).not.toContain('seterusnya');
  });

  test('jobs waiting on a refused load get EngineNotReadyError; a later warmup retries', async () => {
    const { f, eng } = make({ clip: 'nope' });
    const err = await eng.transcribe({ audio: audio() }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineNotReadyError);
    await Bun.sleep(1);
    await eng.warmup().catch(() => {});
    expect(f.children.length).toBe(2);
  });

  test('VAD disabled → only the clip check runs', async () => {
    const { f, eng } = make({ silence: 'okay.' }, { vadModelPath: '' });
    await eng.warmup();
    expect(eng.status().state).toBe('ready');
    expect(f.children[0]?.sent.map((m) => m.t)).toEqual(['transcribe']);
  });

  test('selfTest: false → ready without probing', async () => {
    const f = fakeSpawner({ clip: 'garbage' });
    const eng = createSttEngine({ spawn: f.spawn, selfTest: false, config: { idleTimeoutSec: 0 } });
    await eng.warmup();
    expect(eng.status().state).toBe('ready');
    expect(f.children[0]?.sent).toEqual([]);
  });

  test('load_error → EngineNotReadyError, detail kept in lastError', async () => {
    const spawn: SttSpawner = (_cfg, on) => {
      queueMicrotask(() =>
        on.message({ t: 'load_error', message: 'model not found at /m/x.gguf' }),
      );
      return { send: () => {}, kill: () => queueMicrotask(() => on.exit(null, 'SIGTERM')) };
    };
    const eng = createSttEngine({ spawn, selfTest: true, config: { idleTimeoutSec: 0 } });
    const err = await eng.warmup().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineNotReadyError);
    expect((err as Error).message).not.toContain('/m/x.gguf');
    expect(eng.status()).toMatchObject({
      state: 'error',
      lastError: 'model not found at /m/x.gguf',
    });
  });
});
