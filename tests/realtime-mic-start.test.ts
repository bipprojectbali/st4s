/** startMic is cancelable at every await and releases tracks, AudioContext and Blob URL. */
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { startMic } from '../app/lib/realtime-mic';
import {
  isAbortError,
  START_STAGE_TIMEOUT_MS,
  WORKLET_TIMEOUT_MESSAGE,
} from '../app/lib/realtime-start';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

type Stage = 'gum' | 'addModule' | 'resume';

// One controllable fake world per test: each stage's promise is settled by the test.
let gates: Record<Stage, ReturnType<typeof deferred<void>>>;
let stoppedTracks: number;
let ctxs: FakeContext[];
let revoked: string[];
let created: string[];

class FakeContext {
  state: AudioContextState = 'suspended';
  sampleRate = 48_000;
  destination = {};
  closed = 0;
  audioWorklet = { addModule: (_url: string) => gates.addModule.promise };
  constructor() {
    ctxs.push(this);
  }
  resume() {
    return gates.resume.promise.then(() => {
      this.state = 'running';
    });
  }
  async close() {
    this.closed++;
    this.state = 'closed';
  }
  createMediaStreamSource() {
    return { connect() {}, disconnect() {} };
  }
}

class FakeNode {
  port = { onmessage: null as unknown, postMessage() {} };
  connect() {}
  disconnect() {}
}

const fakeStream = () => ({ getTracks: () => [{ stop: () => void stoppedTracks++ }] });

const g = globalThis as Record<string, unknown>;
let urlSpies: Array<{ mockRestore: () => void }> = [];

beforeEach(() => {
  gates = { gum: deferred(), addModule: deferred(), resume: deferred() };
  stoppedTracks = 0;
  ctxs = [];
  revoked = [];
  created = [];
  g.AudioContext = FakeContext;
  g.AudioWorkletNode = FakeNode;
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: () => gates.gum.promise.then(fakeStream) },
  });
  urlSpies = [
    spyOn(URL, 'createObjectURL').mockImplementation(() => {
      created.push(`blob:${created.length}`);
      return created[created.length - 1];
    }),
    spyOn(URL, 'revokeObjectURL').mockImplementation((u: string) => void revoked.push(u)),
  ];
});

afterEach(() => {
  delete g.AudioContext;
  delete g.AudioWorkletNode;
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
  for (const s of urlSpies) s.mockRestore();
});

const tick = () => Bun.sleep(0);

// Opens every gate before `stage`, aborts while `stage` is pending, then lets `stage` resolve late.
async function abortAt(stage: Stage) {
  const ac = new AbortController();
  const run = startMic(() => {}, ac.signal).catch((e: unknown) => e);
  for (const s of ['gum', 'addModule', 'resume'] as Stage[]) {
    if (s === stage) break;
    gates[s].resolve();
    await tick();
  }
  ac.abort();
  const err = await run;
  gates[stage].resolve(); // the browser API settles after the user gave up
  await tick();
  return err;
}

describe('startMic abort', () => {
  test('during getUserMedia: context closed, late stream stopped, no Blob URL', async () => {
    expect(isAbortError(await abortAt('gum'))).toBe(true);
    expect(ctxs[0].closed).toBe(1);
    expect(stoppedTracks).toBe(1);
    expect(created).toEqual([]);
  });

  test('during addModule: tracks stopped, context closed, Blob URL revoked', async () => {
    expect(isAbortError(await abortAt('addModule'))).toBe(true);
    expect(stoppedTracks).toBe(1);
    expect(ctxs[0].closed).toBe(1);
    expect(revoked).toEqual(created);
    expect(created).toHaveLength(1);
  });

  test('during resume: tracks stopped and context closed', async () => {
    expect(isAbortError(await abortAt('resume'))).toBe(true);
    expect(stoppedTracks).toBe(1);
    expect(ctxs[0].closed).toBe(1);
    expect(revoked).toEqual(created);
  });

  test('already-aborted signal acquires nothing', async () => {
    const ac = new AbortController();
    ac.abort();
    const err = await startMic(() => {}, ac.signal).catch((e: unknown) => e);
    expect(isAbortError(err)).toBe(true);
    expect(ctxs).toHaveLength(0);
  });

  test('no abort: resolves a running mic whose stop releases everything', async () => {
    const run = startMic(() => {}, new AbortController().signal);
    gates.gum.resolve();
    gates.addModule.resolve();
    gates.resume.resolve();
    const mic = await run;
    expect(mic.rate).toBe(48_000);
    expect(ctxs[0].closed).toBe(0);
    await mic.stop();
    expect(stoppedTracks).toBe(1);
    expect(ctxs[0].closed).toBe(1);
  });
});

describe('startMic addModule timeout', () => {
  test('a hanging addModule fails with the actionable message and releases resources', async () => {
    const timers = spyOn(globalThis, 'setTimeout').mockImplementation(((
      fn: () => void,
      ms: number,
    ) => {
      expect(ms).toBe(START_STAGE_TIMEOUT_MS);
      queueMicrotask(fn);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);
    try {
      const run = startMic(() => {}, new AbortController().signal).catch((e: Error) => e);
      gates.gum.resolve();
      const err = (await run) as Error;
      expect(err.message).toBe(WORKLET_TIMEOUT_MESSAGE);
      expect(isAbortError(err)).toBe(false);
      expect(stoppedTracks).toBe(1);
      expect(ctxs[0].closed).toBe(1);
      expect(revoked).toEqual(created);
    } finally {
      timers.mockRestore();
    }
  });
});
