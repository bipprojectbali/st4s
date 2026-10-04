/** Any container/codec ffmpeg knows -> 16 kHz mono float32, via stdin/stdout pipes. */
import { v1Config } from '../v1/config';

/** Absolute ffmpeg path, or null when it is not installed. */
export function findFfmpeg(): string | null {
  return Bun.which(v1Config.ffmpegPath);
}

/** Runs ffmpeg with an argv array (no shell); rejects with ffmpeg's last stderr line on failure or timeout. */
export async function ffmpegTo16kMono(
  bin: string,
  bytes: Uint8Array<ArrayBuffer>,
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
      '-f',
      'f32le',
      '-ar',
      '16000',
      '-ac',
      '1',
      'pipe:1',
    ],
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
