/** argv marker that makes the compiled binary run an engine child instead of the server. */
export const ENGINE_CHILD_FLAG = '--st4s-engine-child';

/** Engine children the binary can re-exec itself as. */
export type EngineChildKind = 'stt' | 'tts';

/** Which engine child this argv asks for, or null for the server (user args start at index 2 in script and binary mode). */
export function engineChildKind(argv: readonly string[]): EngineChildKind | null {
  if (argv[2] !== ENGINE_CHILD_FLAG) return null;
  const kind = argv[3];
  if (kind === 'stt' || kind === 'tts') return kind;
  throw new Error(`${ENGINE_CHILD_FLAG} expects "stt" or "tts", got "${kind ?? ''}"`);
}

/** Command that starts an engine child: a compiled binary re-execs itself, source mode runs the .ts entry with bun. */
export function engineChildCommand(
  kind: EngineChildKind,
  sourcePath: string,
  standalone: boolean = Bun.isStandaloneExecutable,
  execPath: string = process.execPath,
): string[] {
  return standalone ? [execPath, ENGINE_CHILD_FLAG, kind] : [execPath, sourcePath];
}
