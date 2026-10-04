import path from 'node:path';
import { engineChildCommand } from '../child-argv';
import type { ChildMsg, ParentMsg } from './protocol';

/** Handle to a running TTS child process. */
export interface ChildHandle {
  send(msg: ParentMsg): void;
  kill(): void;
  readonly exited: Promise<unknown>;
}

/** Starts a TTS child; injectable so tests can run without the model. */
export type Spawner = (handlers: {
  onMessage(msg: ChildMsg): void;
  onExit(code: number | null, signal: string | null): void;
}) => ChildHandle;

// Source-mode entry; a compiled binary re-execs itself instead (see child-argv.ts).
const CHILD_PATH = path.join(import.meta.dir, 'child.ts');

/** Default spawner: `bun child.ts` (or `<binary> --s4s-engine-child tts`) with structured-clone IPC. */
export const bunSpawner: Spawner = ({ onMessage, onExit }) => {
  const proc = Bun.spawn(engineChildCommand('tts', CHILD_PATH), {
    serialization: 'advanced',
    stdio: ['ignore', 'inherit', 'inherit'],
    ipc: (msg) => onMessage(msg as ChildMsg),
    onExit: (_p, code, signal) => onExit(code, signal == null ? null : String(signal)),
  });
  return { send: (msg) => proc.send(msg), kill: () => proc.kill(), exited: proc.exited };
};
