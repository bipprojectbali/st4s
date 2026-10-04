import pino from 'pino';
import { env, isProd } from './env';
import { logBuffer } from './mcp/log-buffer';
import { registerProcessLogger } from './ssr-log';

// Bun.isStandaloneExecutable is true when running inside a compiled binary (bun build --compile).
// In binary mode we avoid pino-pretty's worker threads and file-based logging.
const isStandalone = Bun.isStandaloneExecutable;

// In-memory ring buffer feeding the MCP log tools and /dev/server-logs. Layered
// into every mode (dev, prod, binary) at info+ so operators and agents can read
// recent lifecycle lines and errors without shell access.
const bufferStream = { stream: logBuffer.asWritable(), level: 'info' as const };

async function createLogger() {
  if (isStandalone) {
    // Binary mode: stdout-only JSON logging — no worker threads, no FS writes.
    // Log rotation at the process-manager / container layer (systemd, Docker, etc.).
    return pino(
      { level: 'info', base: { env: env.NODE_ENV } },
      pino.multistream([{ stream: process.stdout, level: 'info' as const }, bufferStream]),
    );
  }
  if (isProd) {
    // Regular prod (bun run start): stdout + daily-rotating log file via pino-roll.
    // pino-roll's build() creates a SonicBoom stream (no worker threads).
    // pino-roll v4 takes a single options object (v3 took `(file, opts)`).
    const build = (await import('pino-roll')).default;
    const rollStream = await build({
      file: 'logs/app.log',
      frequency: 'daily',
      size: '10m',
      limit: { count: 7 },
      mkdir: true,
    });
    return pino(
      { level: 'info', base: { env: env.NODE_ENV } },
      pino.multistream([
        { stream: process.stdout, level: 'info' as const },
        { stream: rollStream, level: 'warn' as const },
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
