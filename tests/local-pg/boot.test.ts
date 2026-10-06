/** Boot glue with a fake starter: a set DATABASE_URL is never touched; an empty one gets the socket env injected. */
import { afterEach, describe, expect, mock, test } from 'bun:test';
import { acquireLocalPg, bootLocalPg, stopLocalPg } from '../../server/local-pg/boot';
import { type LocalPg, socketEnv } from '../../server/local-pg/server';

const fakePg = (stop = mock(async () => {})): LocalPg => ({
  pid: 4242,
  dataDir: '/fake/pg/data',
  socketDir: '/fake/pg/data',
  env: socketEnv('/fake/pg/data'),
  stop,
});
const quiet = () => {};

afterEach(stopLocalPg);

describe('bootLocalPg', () => {
  test('DATABASE_URL set → returns null, starter never called, env untouched', async () => {
    const start = mock(async () => fakePg());
    const env = { DATABASE_URL: 'postgres://u:p@db:5432/x' };
    expect(await bootLocalPg(env, { start, log: quiet })).toBeNull();
    expect(start).not.toHaveBeenCalled();
    expect(env).toEqual({ DATABASE_URL: 'postgres://u:p@db:5432/x' });
    expect(await acquireLocalPg(env)).toBeFunction();
    expect(env).toEqual({ DATABASE_URL: 'postgres://u:p@db:5432/x' });
  });

  test('empty DATABASE_URL → socket env injected; second call reuses the same sidecar', async () => {
    const start = mock(async () => fakePg());
    const env: Record<string, string | undefined> = { DATABASE_URL: '', PGUSERNAME: 'host-user' };
    const pg = await bootLocalPg(env, { start, log: quiet });
    expect(pg?.pid).toBe(4242);
    expect(env).toMatchObject({
      DATABASE_URL: 'postgres:///st4s',
      PGHOST: '/fake/pg/data',
      PGPORT: '5432',
      PGUSER: 'st4s',
      PGUSERNAME: 'st4s',
    });
    const env2: Record<string, string | undefined> = {};
    expect(await bootLocalPg(env2, { start, log: quiet })).toBe(pg);
    expect(env2.PGHOST).toBe('/fake/pg/data');
    expect(start).toHaveBeenCalledTimes(1);
  });

  test('start failure is wrapped and not memoised', async () => {
    const failing = mock(async (): Promise<LocalPg> => {
      throw new Error('initdb gagal');
    });
    await expect(bootLocalPg({}, { start: failing, log: quiet })).rejects.toThrow(
      'PostgreSQL bawaan gagal start: initdb gagal',
    );
    const ok = mock(async () => fakePg());
    expect(await bootLocalPg({}, { start: ok, log: quiet })).not.toBeNull();
    expect(ok).toHaveBeenCalledTimes(1);
  });
});

describe('stopLocalPg', () => {
  test('stops the started sidecar once; later calls are no-ops', async () => {
    const stop = mock(async () => {});
    await bootLocalPg({}, { start: async () => fakePg(stop), log: quiet });
    await stopLocalPg();
    await stopLocalPg();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
