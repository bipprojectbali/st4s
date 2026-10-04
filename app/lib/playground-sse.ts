/** Minimal `text/event-stream` reader for /api/v1 audio streams (only `data:` lines are used). */

/** Incremental parser: feed text chunks, get each `data:` payload parsed as JSON. */
export function createSseParser(onEvent: (event: unknown) => void) {
  let buf = '';
  return (chunk: string) => {
    buf += chunk;
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      onEvent(JSON.parse(payload));
    }
  };
}

/** Error message carried by an OpenAI-shaped `{ error: { message } }` event, else null. */
export function sseErrorMessage(event: unknown): string | null {
  const err = (event as { error?: { message?: unknown } } | null)?.error;
  return err && typeof err.message === 'string' ? err.message : null;
}

/** Read a streamed Response body to the end, calling `onEvent` per event. */
export async function readSse(res: Response, onEvent: (event: unknown) => void): Promise<void> {
  if (!res.body) throw new Error('Respons streaming tidak punya body.');
  const feed = createSseParser(onEvent);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    feed(value);
  }
  feed('\n');
}
