import path from 'node:path';
import pino from 'pino';
import { env, isProd } from './env';
import { logBuffer } from './mcp/log-buffer';
import { registerProcessLogger } from './ssr-log';
import { st4sLogsDir } from './st4s-home';

// In-memory ring buffer feeding the MCP log tools and /dev/server-logs. Layered
// into every mode (dev, prod, binary) at info+ so operators and agents can read
// recent lifecycle lines and errors without shell access.
const bufferStream = { stream: logBuffer.asWritable(), level: 'info' as const };

/** Daily-rotating `<logs>/app.log` (SonicBoom, no worker threads — safe in the compiled binary). */
async function rollStream() {
  const file = path.join(st4sLogsDir(), 'app.log');
  // pino-roll v4 takes a single options object (v3 took `(file, opts)`).
  const build = (await import('pino-roll')).default;
  try {
    return await build({ file, frequency: 'daily', size: '10m', limit: { count: 7 }, mkdir: true });
  } catch (e) {
    throw new Error(
      `Cannot open log file ${file} (set ST4S_HOME to a writable dir): ${(e as Error).message}`,
    );
  }
}

async function createLogger() {
  // Binary (Bun.isStandaloneExecutable) and `bun run start`: stdout JSON + warn+ to a rotating file
  // under st4sLogsDir() — `<ST4S_HOME>/logs` for the binary, cwd-relative `logs/` otherwise.
  if (Bun.isStandaloneExecutable || isProd) {
    return pino(
      { level: 'info', base: { env: env.NODE_ENV } },
      pino.multistream([
        { stream: process.stdout, level: 'info' as const },
        { stream: await rollStream(), level: 'warn' as const },
        bufferStream,
      ]),
    );
  }
  // Dev: pretty console (worker thread) layered with the MCP buffer via multistream.
  return pino(
    { level: 'debug', base: { env: env.NODE_ENV } },
    pino.multistream([
      {
        stream: pino.transport({
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
        }),
        level: 'debug' as const,
      },
      bufferStream,
    ]),
  );
}

// Process-wide singleton: server modules imported from app/ are bundled again
// into build/server/index.js (and re-evaluated on Vite SSR reloads). Without this
// each copy would open its own pino-roll writer and pino-pretty worker.
const g = globalThis as typeof globalThis & { __st4sLogger?: pino.Logger };
g.__st4sLogger ??= await createLogger();
export const logger: pino.Logger = g.__st4sLogger;
// Let the SSR entry log through this instance without importing pino (see ssr-log.ts).
registerProcessLogger(logger);
