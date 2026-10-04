import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import { bootEngines, shutdownEngines } from '../../server/engines/boot';
import {
  ENGINE_CHILD_FLAG,
  engineChildCommand,
  engineChildKind,
} from '../../server/engines/child-argv';
import { getStt, getTts, setEngines } from '../../server/engines/registry';

const g = globalThis as { __s4sBootedEngines?: unknown };

afterAll(() => {
  // Leave the shared registry empty so no later test file sees real engines.
  setEngines({ stt: null, tts: null });
  delete g.__s4sBootedEngines;
});

describe('bootEngines', () => {
  test('registers both engines once without starting a child', () => {
    const first = bootEngines();
    expect(bootEngines()).toBe(first);
    expect(getStt()).toBe(first.stt);
    expect(getTts()).toBe(first.tts);
    expect(first.stt.status().state).toBe('unloaded');
    expect(first.tts.status().state).toBe('unloaded');
  });

  test('shutdownEngines unloads both engines', async () => {
    const { stt, tts } = bootEngines();
    const sttUnload = spyOn(stt, 'unload');
    const ttsUnload = spyOn(tts, 'unload');
    await shutdownEngines();
    expect(sttUnload).toHaveBeenCalledTimes(1);
    expect(ttsUnload).toHaveBeenCalledTimes(1);
  });
});

describe('engine child argv', () => {
  test('server argv is not a child', () => {
    expect(engineChildKind(['bun', '/$bunfs/root/makuro'])).toBeNull();
    expect(engineChildKind(['bun', '/$bunfs/root/makuro', '--port', '3000'])).toBeNull();
  });

  test('flag selects the engine child', () => {
    expect(engineChildKind(['bun', '/$bunfs/root/makuro', ENGINE_CHILD_FLAG, 'stt', '{}'])).toBe(
      'stt',
    );
    expect(engineChildKind(['bun', '/$bunfs/root/makuro', ENGINE_CHILD_FLAG, 'tts'])).toBe('tts');
  });

  test('unknown child kind fails loudly', () => {
    expect(() => engineChildKind(['bun', 'makuro', ENGINE_CHILD_FLAG, 'gpu'])).toThrow(
      'expects "stt" or "tts"',
    );
  });

  test('binary re-execs itself; source mode runs the .ts entry', () => {
    expect(engineChildCommand('stt', '/src/child.ts', true, '/opt/makuro')).toEqual([
      '/opt/makuro',
      ENGINE_CHILD_FLAG,
      'stt',
    ]);
    expect(engineChildCommand('tts', '/src/child.ts', false, '/usr/bin/bun')).toEqual([
      '/usr/bin/bun',
      '/src/child.ts',
    ]);
  });
});
