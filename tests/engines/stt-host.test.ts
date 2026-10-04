import { afterEach, describe, expect, test } from 'bun:test';
import path from 'node:path';
import type { SttConfig } from '../../server/engines/stt/config';
import { spawnBunChild, sttChildEnv } from '../../server/engines/stt/host';

const prev = process.env.CRISPASR_VAD_FAILOVER;
afterEach(() => {
  if (prev === undefined) delete process.env.CRISPASR_VAD_FAILOVER;
  else process.env.CRISPASR_VAD_FAILOVER = prev;
});

describe('sttChildEnv', () => {
  test('forces VAD failover off even when the parent turns it on', () => {
    const env = sttChildEnv({ CRISPASR_VAD_FAILOVER: '1', PATH: '/bin', STT_MODEL: '/m.gguf' });
    expect(env).toEqual({ CRISPASR_VAD_FAILOVER: '0', PATH: '/bin', STT_MODEL: '/m.gguf' });
  });

  test('adds the override when the parent does not set it', () => {
    expect(sttChildEnv({}).CRISPASR_VAD_FAILOVER).toBe('0');
  });
});

describe('spawnBunChild', () => {
  test('the spawned child sees failover off and keeps the inherited env', async () => {
    process.env.CRISPASR_VAD_FAILOVER = '1';
    const fixture = path.join(import.meta.dir, 'stt-host-env-child.ts');
    const got = await new Promise<unknown>((resolve, reject) => {
      let msg: unknown;
      spawnBunChild(fixture)({} as SttConfig, {
        message: (m) => {
          msg = m;
        },
        exit: (code) =>
          code === 0 ? resolve(msg) : reject(new Error(`fixture child exited ${code}`)),
      });
    });
    expect(got).toEqual({ failover: '0', path: process.env.PATH ?? null });
  });
});
