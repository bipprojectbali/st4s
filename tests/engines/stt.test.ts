import { describe, expect, test } from 'bun:test';
import { createSttEngine } from '../../server/engines/stt';
import { EngineUnloadedError } from '../../server/engines/errors';
import type { SttChildEvents, SttSpawner } from '../../server/engines/stt/host';
import type { ToChild, TranscribeMsg } from '../../server/engines/stt/protocol';
import { EngineBusyError, type TranscribeResult } from '../../server/engines/types';

type FakeChild = { on: SttChildEvents; sent: ToChild[]; killed: boolean; exit(): void };

/** In-process fake child: records what the engine sends; tests drive replies by hand. */
function fakeSpawner(opts: { autoReady?: boolean; holdExit?: boolean } = {}) {
  const children: FakeChild[] = [];
  const spawn: SttSpawner = (_cfg, on) => {
    const c: FakeChild = { on, sent: [], killed: false, exit: () => on.exit(null, 'SIGTERM') };
    children.push(c);
    if (opts.autoReady !== false) queueMicrotask(() => on.message({ t: 'ready', loadMs: 1, rss: 1000, backend: 'fake', gpu: false }));
    return {
      send: (m) => c.sent.push(m),
      kill: () => {
        c.killed = true;
        if (!opts.holdExit) queueMicrotask(() => c.exit());
      },
    };
  };
  return { spawn, children };
}

const tick = () => Bun.sleep(1);
const jobs = (c: FakeChild) => c.sent.filter((m): m is TranscribeMsg => m.t === 'transcribe');
const audio = (sec = 1) => new Float32Array(16_000 * sec);
const result = (text: string): TranscribeResult => ({ text, language: 'id', duration: 1, segments: [] });

function reply(c: FakeChild, id: number, text: string) {
  c.on.message({ t: 'result', id, result: result(text), rss: 2000 });
}

const make = (spawn: SttSpawner, config = {}) =>
  createSttEngine({ spawn, config: { maxQueue: 4, idleTimeoutSec: 0, modelPath: '/m/qwen3-asr.gguf', ...config } });

describe('stt engine (fake child)', () => {
  test('lazy loads and runs the queue serially in FIFO order', async () => {
    const f = fakeSpawner();
    const eng = make(f.spawn);
    expect(f.children.length).toBe(0);
    expect(eng.status().state).toBe('unloaded');

    const ps = ['a', 'b', 'c'].map(() => eng.transcribe({ audio: audio() }));
    await tick();
    const c = f.children[0]!;
    expect(f.children.length).toBe(1);
    expect(c.sent.length).toBe(1);
    expect(eng.status()).toMatchObject({ state: 'busy', queued: 2, model: 'qwen3-asr' });

    for (let i = 0; i < 3; i++) {
      const m = jobs(c)[i]!;
      expect(m.language).toBe('id');
      reply(c, m.id, `r${i}`);
      await tick();
    }
    expect((await Promise.all(ps)).map((r) => r.text)).toEqual(['r0', 'r1', 'r2']);
    expect(c.sent.map((m) => m.id)).toEqual([1, 2, 3]);
    const st = eng.status();
    expect(st.state).toBe('ready');
    expect(st.stats.requests).toBe(3);
    expect(st.stats.p50Ms).not.toBeNull();
    expect(st.rssBytes).toBe(2000);
  });

  test('forwards deltas before the final result', async () => {
    const f = fakeSpawner();
    const eng = make(f.spawn);
    const seen: string[] = [];
    const p = eng.transcribe({ audio: audio(), onDelta: (d) => seen.push(`delta:${d}`) }).then((r) => seen.push(`final:${r.text}`));
    await tick();
    const c = f.children[0]!;
    c.on.message({ t: 'delta', id: 1, text: 'halo' });
    c.on.message({ t: 'delta', id: 1, text: ' dunia' });
    reply(c, 1, 'halo dunia');
    await p;
    expect(seen).toEqual(['delta:halo', 'delta: dunia', 'final:halo dunia']);
  });

  test('throws EngineBusyError when the queue is full', async () => {
    const f = fakeSpawner();
    const eng = make(f.spawn, { maxQueue: 2 });
    const ok = [0, 1, 2].map(() => eng.transcribe({ audio: audio() }));
    await tick();
    // one running + two queued; the next one overflows
    const err = await eng.transcribe({ audio: audio() }).catch((e) => e);
    expect(err).toBeInstanceOf(EngineBusyError);
    expect(err.kind).toBe('stt');
    expect(err.retryAfterSec).toBeGreaterThanOrEqual(1);
    const c = f.children[0]!;
    for (let i = 0; i < 3; i++) {
      reply(c, c.sent[i]!.id, 'x');
      await tick();
    }
    await Promise.all(ok);
  });

  test('abort while queued removes the job; abort while running drops its result', async () => {
    const f = fakeSpawner();
    const eng = make(f.spawn);
    const running = new AbortController();
    const queued = new AbortController();
    const deltas: string[] = [];
    const p1 = eng.transcribe({ audio: audio(), signal: running.signal, onDelta: (d) => deltas.push(d) });
    const p2 = eng.transcribe({ audio: audio(), signal: queued.signal });
    const p3 = eng.transcribe({ audio: audio() });
    await tick();
    expect(eng.status().queued).toBe(2);

    queued.abort();
    await expect(p2).rejects.toThrow();
    expect(eng.status().queued).toBe(1);

    running.abort();
    await expect(p1).rejects.toThrow();
    const c = f.children[0]!;
    c.on.message({ t: 'delta', id: 1, text: 'ignored' });
    expect(deltas).toEqual([]);
    expect(c.sent.at(-1)).toEqual({ t: 'cancel', id: 1 });
    reply(c, 1, 'late');
    await tick();
    // job 2 never reached the child
    expect(jobs(c).map((m) => m.id)).toEqual([1, 3]);
    reply(c, 3, 'third');
    expect((await p3).text).toBe('third');
  });

  test('already-aborted signal rejects without spawning', async () => {
    const f = fakeSpawner();
    const eng = make(f.spawn);
    const ac = new AbortController();
    ac.abort();
    await expect(eng.transcribe({ audio: audio(), signal: ac.signal })).rejects.toThrow();
    expect(f.children.length).toBe(0);
  });

  test('child crash rejects the in-flight job with context, then respawns', async () => {
    const f = fakeSpawner();
    const eng = make(f.spawn);
    const p1 = eng.transcribe({ audio: audio() });
    await tick();
    f.children[0]!.on.exit(139, 'SIGSEGV');
    await expect(p1).rejects.toThrow(/exited unexpectedly \(code 139, signal SIGSEGV\)/);
    const st = eng.status();
    expect(st.state).toBe('error');
    expect(st.lastError).toContain('SIGSEGV');
    expect(st.stats.errors).toBe(1);

    const p2 = eng.transcribe({ audio: audio() });
    await tick();
    expect(f.children.length).toBe(2);
    reply(f.children[1]!, f.children[1]!.sent[0]!.id, 'back');
    expect((await p2).text).toBe('back');
    expect(eng.status().state).toBe('ready');
  });

  test('crash during load fails the waiting job, queued jobs get a fresh child', async () => {
    const f = fakeSpawner({ autoReady: false });
    const eng = make(f.spawn);
    const p1 = eng.transcribe({ audio: audio() });
    const p2 = eng.transcribe({ audio: audio() });
    await tick();
    f.children[0]!.on.message({ t: 'load_error', message: 'STT model load failed: bad gguf' });
    await expect(p1).rejects.toThrow(/bad gguf/);
    // engine kills the failed child; the fake's kill() delivers its exit
    expect(f.children[0]!.killed).toBe(true);
    await tick();
    expect(f.children.length).toBe(2);
    f.children[1]!.on.message({ t: 'ready', loadMs: 1, rss: 1, backend: 'fake', gpu: false });
    await tick();
    reply(f.children[1]!, f.children[1]!.sent[0]!.id, 'ok');
    expect((await p2).text).toBe('ok');
  });

  test('child transcription error rejects only that job', async () => {
    const f = fakeSpawner();
    const eng = make(f.spawn);
    const p = eng.transcribe({ audio: audio() });
    await tick();
    f.children[0]!.on.message({ t: 'error', id: 1, message: 'span failed', rss: 1 });
    await expect(p).rejects.toThrow('STT transcription failed: span failed');
    expect(eng.status().state).toBe('ready');
  });

  test('idle unload kills the child after the timeout; next request reloads', async () => {
    const f = fakeSpawner();
    const eng = make(f.spawn, { idleTimeoutSec: 0.05 });
    await eng.warmup();
    expect(eng.status().state).toBe('ready');
    expect(eng.status().loadedAt).not.toBeNull();
    await Bun.sleep(120);
    expect(f.children[0]!.killed).toBe(true);
    expect(eng.status()).toMatchObject({ state: 'unloaded', loadedAt: null, rssBytes: null });

    const p = eng.transcribe({ audio: audio() });
    await tick();
    expect(f.children.length).toBe(2);
    reply(f.children[1]!, 1, 'again');
    expect((await p).text).toBe('again');
  });

  test('idle timer is not armed while work is pending and 0 disables it', async () => {
    const f = fakeSpawner();
    const eng = make(f.spawn, { idleTimeoutSec: 0 });
    await eng.warmup();
    await Bun.sleep(20);
    expect(f.children[0]!.killed).toBe(false);
    await eng.unload();
    expect(f.children[0]!.killed).toBe(true);
    expect(eng.status().state).toBe('unloaded');
  });

  test('unload rejects the in-flight job', async () => {
    const f = fakeSpawner();
    const eng = make(f.spawn);
    const p = eng.transcribe({ audio: audio() });
    await tick();
    await eng.unload();
    const err = await p.catch((e) => e);
    expect(err).toBeInstanceOf(EngineUnloadedError);
    expect(err.message).toBe('STT engine unloaded');
    expect(eng.status().state).toBe('unloaded');
  });

  test('unload rejects the in-flight and every queued job without respawning', async () => {
    const f = fakeSpawner();
    const eng = make(f.spawn);
    const ps = [1, 2, 3].map(() => eng.transcribe({ audio: audio() }).catch((e) => e));
    await tick();
    expect(eng.status()).toMatchObject({ state: 'busy', queued: 2 });
    await eng.unload();
    const errs = await Promise.all(ps);
    for (const e of errs) expect(e).toBeInstanceOf(EngineUnloadedError);
    expect(errs[0].kind).toBe('stt');
    await tick();
    expect(f.children.length).toBe(1);
    expect(jobs(f.children[0]!).length).toBe(1);
    expect(eng.status()).toMatchObject({ state: 'unloaded', queued: 0 });
  });

  test('unload during model load rejects the waiting jobs without respawning', async () => {
    const f = fakeSpawner({ autoReady: false });
    const eng = make(f.spawn);
    const ps = [1, 2].map(() => eng.transcribe({ audio: audio() }).catch((e) => e));
    await tick();
    expect(eng.status().state).toBe('loading');
    await eng.unload();
    for (const e of await Promise.all(ps)) expect(e).toBeInstanceOf(EngineUnloadedError);
    await tick();
    expect(f.children.length).toBe(1);
    expect(jobs(f.children[0]!).length).toBe(0);
    expect(eng.status().state).toBe('unloaded');
  });

  test('a job arriving while the child exits waits, then loads a fresh child', async () => {
    const f = fakeSpawner({ holdExit: true });
    const eng = make(f.spawn);
    await eng.warmup();
    const u = eng.unload();
    const p = eng.transcribe({ audio: audio() });
    await tick();
    expect(f.children.length).toBe(1);
    expect(jobs(f.children[0]!).length).toBe(0);
    f.children[0]!.exit();
    await u;
    await tick();
    expect(f.children.length).toBe(2);
    reply(f.children[1]!, jobs(f.children[1]!)[0]!.id, 'fresh');
    expect((await p).text).toBe('fresh');
  });

  test('concurrent unload calls all resolve and kill the child once', async () => {
    const f = fakeSpawner();
    const eng = make(f.spawn);
    await eng.warmup();
    let kills = 0;
    const c = f.children[0]!;
    const origOn = c.on.exit;
    c.on.exit = (...a) => (kills++, origOn(...a));
    const done = await Promise.all([eng.unload(), eng.unload(), eng.unload()]);
    expect(done).toHaveLength(3);
    expect(kills).toBe(1);
    expect(eng.status().state).toBe('unloaded');
    await eng.unload();
  });

  test('a cancelled reply frees the queue for the next job without counting an error', async () => {
    const f = fakeSpawner();
    const eng = make(f.spawn);
    const ac = new AbortController();
    const p1 = eng.transcribe({ audio: audio(), signal: ac.signal });
    const p2 = eng.transcribe({ audio: audio() });
    await tick();
    const c = f.children[0]!;
    ac.abort();
    await expect(p1).rejects.toThrow();
    expect(c.sent.map((m) => m.t)).toEqual(['transcribe', 'cancel']);
    c.on.message({ t: 'cancelled', id: 1, rss: 1 });
    await tick();
    expect(jobs(c).map((m) => m.id)).toEqual([1, 2]);
    reply(c, 2, 'next');
    expect((await p2).text).toBe('next');
    expect(eng.status().stats.errors).toBe(0);
  });
});
