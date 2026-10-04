/** responseBody: a client cancel while a pull awaits the next chunk must not log a false stream failure. */
import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import { logger } from '../../server/logger';
import { responseBody } from '../../server/v1/speech-stream';

const warn = spyOn(logger, 'warn');
afterAll(() => warn.mockRestore());

/** Iterator whose next() resolves only when the test says so (generators would queue return() behind next()). */
function manualBytes() {
  const waiters: Array<(r: IteratorResult<Uint8Array>) => void> = [];
  let returned = false;
  const it: AsyncIterator<Uint8Array> = {
    next: () => new Promise((resolve) => waiters.push(resolve)),
    return: async () => {
      returned = true;
      return { done: true, value: undefined };
    },
  };
  return {
    bytes: { [Symbol.asyncIterator]: () => it } as AsyncIterable<Uint8Array>,
    push: (chunk: Uint8Array) => waiters.shift()?.({ done: false, value: chunk }),
    pending: () => waiters.length,
    returned: () => returned,
  };
}

describe('responseBody cancel', () => {
  test('chunk arriving after cancel is dropped without a warning', async () => {
    const src = manualBytes();
    let aborted = 0;
    const ends: Array<{ aborted: boolean }> = [];
    const body = responseBody({
      bytes: src.bytes,
      sse: false,
      chars: 10,
      abort: () => aborted++,
      onEnd: (i) => ends.push(i),
    });
    const reader = body.getReader();
    const first = reader.read();
    await Bun.sleep(5);
    src.push(new Uint8Array([1, 2]));
    expect((await first).value).toEqual(new Uint8Array([1, 2]));
    void reader.read().catch(() => {});
    await Bun.sleep(5);
    expect(src.pending()).toBe(1);
    await reader.cancel();
    src.push(new Uint8Array([3]));
    await Bun.sleep(10);

    expect(aborted).toBe(1);
    expect(src.returned()).toBe(true);
    expect(ends).toEqual([{ ttfbAt: expect.any(Number), aborted: true }] as never);
    expect(warn).not.toHaveBeenCalled();
  });
});
