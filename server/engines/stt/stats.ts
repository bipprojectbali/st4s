import type { EngineStats } from '../types';

const WINDOW = 200;

function pct(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p + 0.5))];
}

/** Rolling latency / RTF window (last 200 samples) plus request and error counters. */
export class RollingStats {
  private ms: number[] = [];
  private rtf: number[] = [];
  private requests = 0;
  private errors = 0;

  ok(latencyMs: number, audioSec: number): void {
    this.requests++;
    this.ms.push(latencyMs);
    if (audioSec > 0) this.rtf.push(latencyMs / 1000 / audioSec);
    if (this.ms.length > WINDOW) this.ms.shift();
    if (this.rtf.length > WINDOW) this.rtf.shift();
  }

  fail(): void {
    this.requests++;
    this.errors++;
  }

  snapshot(): EngineStats {
    const ms = [...this.ms].sort((a, b) => a - b);
    const rtf = [...this.rtf].sort((a, b) => a - b);
    return {
      requests: this.requests,
      errors: this.errors,
      p50Ms: pct(ms, 0.5),
      p95Ms: pct(ms, 0.95),
      rtfP50: pct(rtf, 0.5),
    };
  }
}
