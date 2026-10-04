/** Gapless WebAudio playback of streamed 16-bit little-endian mono PCM chunks. */

/** OpenAI `pcm` output rate (protocol constant, mirrors PCM_RATE in server/audio/encode.ts). */
export const PCM_RATE = 24_000;

/** Decode base64 into bytes. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** s16le bytes → Float32 in [-1, 1]; an odd trailing byte is returned as `rest` for the next chunk. */
export function s16leToFloat(bytes: Uint8Array): {
  samples: Float32Array<ArrayBuffer>;
  rest: Uint8Array;
} {
  const n = bytes.length >> 1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
  return { samples, rest: bytes.slice(n * 2) };
}

/** Schedules each chunk right after the previous one so playback starts on the first chunk. */
export function createPcmPlayer(rate = PCM_RATE) {
  const ctx = new AudioContext({ sampleRate: rate });
  let at = 0;
  let carry: Uint8Array = new Uint8Array(0);
  const sources = new Set<AudioBufferSourceNode>();
  return {
    push(chunk: Uint8Array) {
      const joined = new Uint8Array(carry.length + chunk.length);
      joined.set(carry);
      joined.set(chunk, carry.length);
      const { samples, rest } = s16leToFloat(joined);
      carry = rest;
      if (!samples.length) return;
      const buf = ctx.createBuffer(1, samples.length, rate);
      buf.copyToChannel(samples, 0);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      at = Math.max(at, ctx.currentTime + 0.05);
      src.start(at);
      at += buf.duration;
      sources.add(src);
      src.onended = () => sources.delete(src);
    },
    /** Resolves when everything scheduled so far has played. */
    drained(): Promise<void> {
      const ms = Math.max(0, (at - ctx.currentTime) * 1000);
      return new Promise((r) => setTimeout(r, ms));
    },
    stop() {
      for (const s of sources) s.stop();
      sources.clear();
      void ctx.close();
    },
  };
}
export type PcmPlayer = ReturnType<typeof createPcmPlayer>;
