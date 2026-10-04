import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EngineNotReadyError, EngineUnloadedError } from '../../server/engines/errors';
import { createTtsEngine } from '../../server/engines/tts';
import type { ChildMsg, ParentMsg } from '../../server/engines/tts/protocol';
import type { Spawner } from '../../server/engines/tts/spawner';
import { EngineBusyError, type SpeakRequest } from '../../server/engines/types';

const modelDir = fs.mkdtempSync(path.join(os.tmpdir(), 'st4s-tts-test-'));
fs.mkdirSync(path.join(modelDir, 'onnx'));
fs.mkdirSync(path.join(modelDir, 'voice_styles'));
fs.writeFileSync(
  path.join(modelDir, 'onnx', 'tts.json'),
  JSON.stringify({ ae: { sample_rate: 1000 } }),
);
for (const v of ['M1', 'F1'])
  fs.writeFileSync(path.join(modelDir, 'voice_styles', `${v}.json`), '{}');
afterAll(() => fs.rmSync(modelDir, { recursive: true, force: true }));

interface FakeChild {
  sent: ParentMsg[];
  killed: boolean;
  reply(id: number, samples?: number): void;
  fail(id: number): void;
  crash(): void;
  exit(): void;
  loaded(): void;
}

type FakeOpts = { failLoad?: boolean; holdExit?: boolean; holdLoad?: boolean };

function fakeSpawner(opts: FakeOpts = {}) {
  const children: FakeChild[] = [];
  const spawn: Spawner = ({ onMessage, onExit }) => {
    let exit: (v: unknown) => void = () => {};
    const exited = new Promise((r) => (exit = r));
    const msg = (m: ChildMsg) => onMessage(m);
    const child = {
      sent: [] as ParentMsg[],
      killed: false,
      exited,
      send(m: ParentMsg) {
        child.sent.push(m);
        if (m.type !== 'load' || opts.holdLoad) return;
        queueMicrotask(() =>
          msg(
            opts.failLoad
              ? { type: 'error', message: 'model missing', rss: 1 }
              : { type: 'loaded', sampleRate: 1000, loadMs: 3, rss: 1234 },
          ),
        );
      },
      kill() {
        child.killed = true;
        if (!opts.holdExit) child.exit();
      },
      exit() {
        exit(0);
        queueMicrotask(() => onExit(null, 'SIGTERM'));
      },
      loaded: () => msg({ type: 'loaded', sampleRate: 1000, loadMs: 3, rss: 1234 }),
      reply: (id: number, samples = 500) =>
        msg({ type: 'result', id, pcm: new Float32Array(samples).fill(0.5), rss: 2000 }),
      fail: (id: number) => msg({ type: 'error', id, message: 'onnx exploded', rss: 2000 }),
      crash: () => onExit(139, null),
    };
    children.push(child);
    return child;
  };
  return { spawn, children };
}

const tick = () => Bun.sleep(1);
const synthIds = (c: FakeChild) => c.sent.flatMap((m) => (m.type === 'synth' ? [m.id] : []));
const req = (extra: Partial<SpeakRequest> = {}): SpeakRequest => ({
  text: 'Halo.',
  voice: 'F1',
  language: 'id',
  speed: 1,
  ...extra,
});

function setup(config: Record<string, number> = {}, opts: FakeOpts = {}) {
  const fake = fakeSpawner(opts);
  const engine = createTtsEngine({
    spawn: fake.spawn,
    config: { modelDir, steps: 8, threads: 0, maxQueue: 8, idleTimeoutSec: 0, ...config },
  });
  return { engine, ...fake };
}

describe('tts engine', () => {
  test('reads sampleRate and voices from the model dir, loads lazily', async () => {
    const { engine, children } = setup();
    expect(engine.sampleRate).toBe(1000);
    expect(engine.voices()).toEqual(['F1', 'M1']);
    expect(engine.status().state).toBe('unloaded');
    expect(children).toHaveLength(0);
    await engine.warmup();
    expect(children).toHaveLength(1);
    const s = engine.status();
    expect(s.state).toBe('ready');
    expect(s.rssBytes).toBe(1234);
    expect(s.loadedAt).not.toBeNull();
    expect(children[0]!.sent[0]).toEqual({ type: 'load', modelDir, threads: 0 });
  });

  test('runs requests serially in FIFO order and records stats', async () => {
    const { engine, children } = setup();
    const results = [
      engine.synthesize(req()),
      engine.synthesize(req({ steps: 4 })),
      engine.synthesize(req()),
    ];
    await tick();
    const child = children[0]!;
    expect(synthIds(child)).toEqual([1]);
    expect(engine.status()).toMatchObject({ state: 'busy', queued: 2 });
    child.reply(1, 100);
    expect(synthIds(child)).toEqual([1, 2]);
    expect(child.sent.at(-1)).toMatchObject({
      type: 'synth',
      id: 2,
      steps: 4,
      voice: 'F1',
      language: 'id',
    });
    child.reply(2, 200);
    child.reply(3, 300);
    expect((await Promise.all(results)).map((p) => p.length)).toEqual([100, 200, 300]);
    const stats = engine.status().stats;
    expect(stats.requests).toBe(3);
    expect(stats.errors).toBe(0);
    expect(stats.p50Ms).not.toBeNull();
    expect(stats.rtfP50).not.toBeNull();
  });

  test('rejects with EngineBusyError when the queue is full', async () => {
    const { engine } = setup({ maxQueue: 2 });
    await engine.warmup();
    const pending = [engine.synthesize(req()), engine.synthesize(req()), engine.synthesize(req())];
    const err = await engine.synthesize(req()).catch((e) => e);
    expect(err).toBeInstanceOf(EngineBusyError);
    expect(err.kind).toBe('tts');
    expect(err.retryAfterSec).toBeGreaterThanOrEqual(1);
    for (const p of pending) p.catch(() => {});
  });

  test('drops a queued request on abort without sending it to the child', async () => {
    const { engine, children } = setup();
    await engine.warmup();
    const first = engine.synthesize(req());
    const ac = new AbortController();
    const second = engine.synthesize(req({ signal: ac.signal }));
    ac.abort();
    await expect(second).rejects.toThrow();
    expect(engine.status().queued).toBe(0);
    children[0]!.reply(1);
    await first;
    expect(synthIds(children[0]!)).toEqual([1]);
  });

  test('discards the result of an aborted running request and continues', async () => {
    const { engine, children } = setup();
    await engine.warmup();
    const ac = new AbortController();
    const running = engine.synthesize(req({ signal: ac.signal }));
    const next = engine.synthesize(req());
    ac.abort(new Error('client gone'));
    await expect(running).rejects.toThrow('client gone');
    expect(synthIds(children[0]!)).toEqual([1]);
    children[0]!.reply(1);
    expect(synthIds(children[0]!)).toEqual([1, 2]);
    children[0]!.reply(2, 42);
    expect((await next).length).toBe(42);
  });

  test('rejects an already-aborted request and invalid input', async () => {
    const { engine, children } = setup();
    const ac = new AbortController();
    ac.abort(new Error('already'));
    await expect(engine.synthesize(req({ signal: ac.signal }))).rejects.toThrow('already');
    await expect(engine.synthesize(req({ voice: 'Z9' }))).rejects.toThrow('Unknown TTS voice "Z9"');
    await expect(engine.synthesize(req({ language: 'xx' }))).rejects.toThrow(
      'Unsupported TTS language',
    );
    await expect(engine.synthesize(req({ text: '  ' }))).rejects.toThrow('empty');
    await expect(engine.synthesize(req({ speed: 9 }))).rejects.toThrow('out of range');
    expect(children).toHaveLength(0);
  });

  test('child synthesis error rejects only that request', async () => {
    const { engine, children } = setup();
    const p = engine.synthesize(req());
    await tick();
    children[0]!.fail(1);
    await expect(p).rejects.toThrow('onnx exploded');
    expect(engine.status()).toMatchObject({ state: 'ready', lastError: 'onnx exploded' });
    expect(engine.status().stats.errors).toBe(1);
  });

  test('crash rejects the running request and respawns for queued work', async () => {
    const { engine, children } = setup();
    const a = engine.synthesize(req());
    const b = engine.synthesize(req());
    await tick();
    children[0]!.crash();
    await expect(a).rejects.toThrow('exited unexpectedly (code 139');
    expect(engine.status().lastError).toContain('exited unexpectedly');
    await tick();
    expect(children).toHaveLength(2);
    children[1]!.reply(2, 7);
    expect((await b).length).toBe(7);
    expect(engine.status().state).toBe('ready');
  });

  test('crash while idle leaves error state until the next request', async () => {
    const { engine, children } = setup();
    await engine.warmup();
    children[0]!.crash();
    expect(engine.status()).toMatchObject({ state: 'error', rssBytes: null });
    const p = engine.synthesize(req());
    await tick();
    children[1]!.reply(1);
    await p;
    expect(engine.status().state).toBe('ready');
  });

  test('load failure rejects queued work with the load error', async () => {
    const { engine } = setup({}, { failLoad: true });
    const err = await engine.synthesize(req()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineNotReadyError);
    expect((err as EngineNotReadyError).message).toContain('Mesin TTS gagal dimuat');
    expect((err as EngineNotReadyError).detail).toContain('model missing');
    expect(engine.status().state).toBe('error');
    expect(engine.status().lastError).toContain('model missing');
  });

  test('unload kills the child; the next request reloads', async () => {
    const { engine, children } = setup();
    await engine.warmup();
    await engine.unload();
    expect(children[0]!.killed).toBe(true);
    expect(engine.status()).toMatchObject({ state: 'unloaded', loadedAt: null });
    const p = engine.synthesize(req());
    await tick();
    children[1]!.reply(1);
    await p;
  });

  test('unload rejects running and queued requests without respawning', async () => {
    const { engine, children } = setup();
    const ps = [1, 2, 3].map(() => engine.synthesize(req()).catch((e) => e));
    await tick();
    expect(synthIds(children[0]!)).toHaveLength(1);
    await engine.unload();
    const errs = await Promise.all(ps);
    for (const e of errs) expect(e).toBeInstanceOf(EngineUnloadedError);
    expect(errs[0].kind).toBe('tts');
    await tick();
    expect(children).toHaveLength(1);
    expect(engine.status()).toMatchObject({ state: 'unloaded', queued: 0 });
  });

  test('unload during model load rejects waiting requests; the late load reply is ignored', async () => {
    const { engine, children } = setup({}, { holdLoad: true });
    const ps = [1, 2].map(() => engine.synthesize(req()).catch((e) => e));
    await tick();
    await engine.unload();
    for (const e of await Promise.all(ps)) expect(e).toBeInstanceOf(EngineUnloadedError);
    children[0]!.loaded();
    await tick();
    expect(children).toHaveLength(1);
    expect(synthIds(children[0]!)).toHaveLength(0);
    expect(engine.status().state).toBe('unloaded');
  });

  test('a request arriving mid-unload waits for the exit, then loads a fresh child', async () => {
    const { engine, children } = setup({}, { holdExit: true, holdLoad: true });
    const first = engine.synthesize(req()).catch((e) => e);
    await tick();
    const u = engine.unload();
    const p = engine.synthesize(req());
    await tick();
    expect(await first).toBeInstanceOf(EngineUnloadedError);
    expect(children).toHaveLength(1);
    children[0]!.exit();
    await u;
    await tick();
    expect(children).toHaveLength(2);
    children[1]!.loaded();
    await tick();
    children[1]!.reply(synthIds(children[1]!)[0]!, 10);
    expect((await p).length).toBe(10);
  });

  test('idle timeout unloads the child', async () => {
    const { engine, children } = setup({ idleTimeoutSec: 0.03 });
    const p = engine.synthesize(req());
    await tick();
    children[0]!.reply(1);
    await p;
    expect(engine.status().state).toBe('ready');
    await Bun.sleep(80);
    expect(children[0]!.killed).toBe(true);
    expect(engine.status().state).toBe('unloaded');
  });
});
