/** Streaming mp3/opus/aac/flac encoding through an `ffmpeg` child process (s16le mono on stdin). */
import { logger } from '../logger';
import type { SpeechFormat } from './encode';

type FfmpegFormat = Exclude<SpeechFormat, 'wav' | 'pcm'>;

const CODEC_ARGS: Record<FfmpegFormat, string[]> = {
  mp3: ['-c:a', 'libmp3lame', '-b:a', '128k', '-f', 'mp3'],
  opus: ['-c:a', 'libopus', '-b:a', '64k', '-f', 'ogg'],
  aac: ['-c:a', 'aac', '-b:a', '128k', '-f', 'adts'],
  flac: ['-c:a', 'flac', '-f', 'flac'],
};

/** True when the ffmpeg binary resolves on PATH (or as an absolute path). */
export function ffmpegAvailable(bin: string): boolean {
  return Bun.which(bin) !== null;
}

/** ffmpeg argv that reads s16le mono at `sampleRate` from stdin and writes `format` to stdout. */
export function ffmpegArgv(bin: string, format: FfmpegFormat, sampleRate: number): string[] {
  return [
    bin, '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-f', 's16le', '-ar', String(sampleRate), '-ac', '1', '-i', 'pipe:0',
    ...CODEC_ARGS[format], 'pipe:1',
  ];
}

/**
 * Pipe PCM16 chunks through ffmpeg; encoded bytes flow out as soon as ffmpeg emits them.
 * The process is killed on `signal` abort or after `timeoutMs`.
 */
export async function* encodeFfmpeg(opts: {
  bin: string;
  format: FfmpegFormat;
  sampleRate: number;
  pcm16: AsyncIterable<Uint8Array>;
  signal: AbortSignal;
  timeoutMs: number;
}): AsyncGenerator<Uint8Array> {
  const proc = Bun.spawn(ffmpegArgv(opts.bin, opts.format, opts.sampleRate), {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: opts.timeoutMs,
  });
  // Bun's spawn `signal` option did not kill ffmpeg on abort here (Bun 1.x), so kill explicitly.
  const kill = () => proc.kill('SIGKILL');
  if (opts.signal.aborted) kill();
  else opts.signal.addEventListener('abort', kill, { once: true });
  // Not awaited on exit: the source may be mid-synthesis; it stops on `signal` or on the next write to a dead pipe.
  void (async () => {
    for await (const chunk of opts.pcm16) {
      proc.stdin.write(chunk);
      await proc.stdin.flush();
    }
    await proc.stdin.end();
  })().catch((err) => {
    // EPIPE after ffmpeg died; the exit code is reported below.
    if (!opts.signal.aborted) logger.warn({ err, format: opts.format }, 'ffmpeg stdin feed stopped');
  });
  try {
    for await (const chunk of proc.stdout) yield chunk;
  } finally {
    opts.signal.removeEventListener('abort', kill);
    // Consumer stopped early (client gone): don't leave ffmpeg running.
    if (proc.exitCode === null) proc.kill('SIGKILL');
    const code = await proc.exited;
    if (code !== 0 && !opts.signal.aborted) {
      const stderr = (await new Response(proc.stderr).text()).slice(0, 300);
      logger.warn({ code, format: opts.format, stderr }, 'ffmpeg exited with an error');
    }
  }
}
