import { isProd } from '../env';
import { logger } from '../logger';
import { startMemoryGuard, stopMemoryGuard } from '../memory-guard/lifecycle';
import { checkEngineDeps, logEngineDeps } from './deps';
import { setEngines } from './registry';
import { createSttEngine } from './stt';
import { createTtsEngine } from './tts';
import type { SttEngine, TtsEngine } from './types';

type Booted = { stt: SttEngine; tts: TtsEngine };

// globalThis survives `bun --hot` re-evaluation, so a reload never orphans a running child.
const g = globalThis as typeof globalThis & {
  __s4sBootedEngines?: Booted;
  __s4sShutdownHooked?: boolean;
};

const SHUTDOWN_TIMEOUT_MS = 5_000;

/**
 * Register the real STT/TTS engines once, log any missing model/library/ffmpeg and start the
 * memory guard; engines are lazy, so no child or model is started here.
 */
export function bootEngines(): Booted {
  if (g.__s4sBootedEngines) return g.__s4sBootedEngines;
  logEngineDeps(checkEngineDeps(), isProd);
  const engines: Booted = { stt: createSttEngine(), tts: createTtsEngine() };
  setEngines(engines);
  g.__s4sBootedEngines = engines;
  startMemoryGuard();
  return engines;
}

/** Stop the memory guard and unload both booted engines (kills their child processes); no-op when nothing was booted. */
export async function shutdownEngines(): Promise<void> {
  stopMemoryGuard();
  const engines = g.__s4sBootedEngines;
  if (!engines) return;
  await Promise.all([engines.stt.unload(), engines.tts.unload()]);
}

/** On SIGINT/SIGTERM unload the engines, then exit, so engine children never outlive the server. */
export function exitOnShutdownSignals(): void {
  if (g.__s4sShutdownHooked) return;
  g.__s4sShutdownHooked = true;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      logger.info({ signal }, 'shutting down: unloading engines');
      setTimeout(() => {
        logger.error(
          { signal, timeoutMs: SHUTDOWN_TIMEOUT_MS },
          'engine unload timed out; exiting anyway',
        );
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS).unref();
      shutdownEngines().then(
        () => process.exit(0),
        (err: unknown) => {
          logger.error({ err, signal }, 'engine unload failed during shutdown');
          process.exit(1);
        },
      );
    });
  }
}
