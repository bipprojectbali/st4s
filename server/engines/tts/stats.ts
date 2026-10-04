import type { EngineStats } from '../types';

const WINDOW = 200;

function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!;
}

/** Request counters plus latency/RTF percentiles over the last 200 requests. */
export class RollingStats {
  private requests = 0;
  private errors = 0;
  private readonly latencies: number[] = [];
  private readonly rtfs: number[] = [];

  /** Record a successful request: wall time and produced audio duration. */
  success(latencyMs: number, audioSec: number): void {
    this.requests++;
    push(this.latencies, latencyMs);
    if (audioSec > 0) push(this.rtfs, latencyMs / 1000 / audioSec);
  }

  /** Record a failed request. */
  failure(): void {
    this.requests++;
    this.errors++;
  }

  get p50Ms(): number | null {
    return percentile(this.latencies, 0.5);
  }

  snapshot(): EngineStats {
    return {
      requests: this.requests,
      errors: this.errors,
      p50Ms: this.p50Ms,
      p95Ms: percentile(this.latencies, 0.95),
      rtfP50: percentile(this.rtfs, 0.5),
    };
  }
}

function push(arr: number[], v: number): void {
  arr.push(v);
  if (arr.length > WINDOW) arr.shift();
}
