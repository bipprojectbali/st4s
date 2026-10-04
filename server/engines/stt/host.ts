import path from 'node:path';
import { engineChildCommand } from '../child-argv';
import type { SttConfig } from './config';
import type { FromChild, ToChild } from './protocol';

/** Handle on a running STT child process. */
export interface SttChild {
  send(m: ToChild): void;
  kill(): void;
}

/** Event sinks the engine passes to a spawner. */
export interface SttChildEvents {
  message(m: FromChild): void;
  exit(code: number | null, signal: string | null): void;
}

/** Starts a child; injectable so tests can run without the native model. */
export type SttSpawner = (cfg: SttConfig, on: SttChildEvents) => SttChild;

/** Child entry in source mode; a compiled binary re-execs itself instead (see child-argv.ts). */
export const CHILD_PATH = path.join(import.meta.dir, 'child.ts');

/** Spawn `bun child.ts <config-json>` (or `<binary> --s4s-engine-child stt <config-json>`) directly, no shell, with IPC. */
export function spawnBunChild(childPath = CHILD_PATH): SttSpawner {
  return (cfg, on) => {
    const proc = Bun.spawn([...engineChildCommand('stt', childPath), JSON.stringify(cfg)], {
      ipc: (m) => on.message(m as FromChild),
      onExit: (_p, code, signal) => on.exit(code, signal == null ? null : String(signal)),
      stdin: 'ignore',
      stdout: 'ignore',
      // Native lib/ggml diagnostics only (verbosity 0); no transcript text is written here.
      stderr: 'inherit',
      serialization: 'advanced',
    });
    return { send: (m) => proc.send(m), kill: () => proc.kill() };
  };
}
