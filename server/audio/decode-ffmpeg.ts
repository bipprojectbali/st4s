/** Any container/codec ffmpeg knows -> 16 kHz mono float32, via stdin/stdout pipes. */
import { v1Config } from '../v1/config';

/** Absolute ffmpeg path, or null when it is not installed. */
export function findFfmpeg(): string | null {
  return Bun.which(v1Config.ffmpegPath);
}

/**
 * Runs ffmpeg with an argv array (no shell); rejects with ffmpeg's last stderr line on failure or timeout.
 * Output stops at `maxSec + 1` s, so a result longer than `maxSec` means the source is over the limit.
 */
export async function ffmpegTo16kMono(
  bin: string,
  bytes: Uint8Array<ArrayBuffer>,
  maxSec = Number.POSITIVE_INFINITY,
): Promise<Float32Array> {
  // ponytail: pipe input, so MP4/M4A with the moov atom at the end may fail; temp file if that shows up.
  const proc = Bun.spawn(
    [
      bin,
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      'pipe:0',
      ...(Number.isFinite(maxSec) ? ['-t', String(maxSec + 1)] : []),
      '-f',
      'f32le',
      '-ar',
      '16000',
      '-ac',
      '1',
      'pipe:1',
    ],
    // With -t ffmpeg exits before reading all of stdin; Bun drops the EPIPE on a Uint8Array stdin
    // (verified on a 25 MB input), and real failures still surface as a non-zero exit below.
    { stdin: bytes, stdout: 'pipe', stderr: 'pipe', timeout: v1Config.ffmpegTimeoutMs },
  );
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    const reason = proc.signalCode
      ? `killed by ${proc.signalCode}`
      : err.trim().split('\n').pop() || `exit ${code}`;
    throw new Error(`ffmpeg failed: ${reason}`);
  }
  return new Float32Array(out, 0, Math.floor(out.byteLength / 4));
}
