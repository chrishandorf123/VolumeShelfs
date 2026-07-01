/** Minimum milliseconds between calls to stay at/under `callsPerMin`. */
export function minIntervalMs(callsPerMin: number): number {
  const r = Number.isFinite(callsPerMin) && callsPerMin > 0 ? callsPerMin : 60;
  return Math.ceil(60000 / r);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * A minimal request pacer: `await pacer.wait()` immediately before each API call
 * and it holds so no more than the configured rate goes out (respecting a
 * provider's per-minute limit). Serialize your calls; don't fan them out.
 */
export class Pacer {
  private last = 0;
  constructor(private readonly intervalMs: number) {}
  async wait(): Promise<void> {
    const gap = this.intervalMs - (Date.now() - this.last);
    if (gap > 0) await sleep(gap);
    this.last = Date.now();
  }
}
