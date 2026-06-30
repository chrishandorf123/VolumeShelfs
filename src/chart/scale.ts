import type { PriceScale } from "../core/types";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Maps prices to vertical pixels within a plot rect (linear or log). */
export class PriceAxis {
  private readonly logLow: number;
  private readonly logHigh: number;
  private readonly useLog: boolean;

  constructor(
    readonly low: number,
    readonly high: number,
    readonly scale: PriceScale,
    private readonly plot: Rect,
  ) {
    this.useLog = scale === "log" && low > 0;
    this.logLow = this.useLog ? Math.log(low) : low;
    this.logHigh = this.useLog ? Math.log(high) : high;
  }

  /** Price -> y pixel (higher price = smaller y). */
  y(price: number): number {
    const v = this.useLog ? Math.log(Math.max(price, 1e-9)) : price;
    const t = (v - this.logLow) / (this.logHigh - this.logLow || 1);
    return this.plot.y + (1 - t) * this.plot.height;
  }

  /** y pixel -> price. */
  price(y: number): number {
    const t = 1 - (y - this.plot.y) / (this.plot.height || 1);
    const v = this.logLow + t * (this.logHigh - this.logLow);
    return this.useLog ? Math.exp(v) : v;
  }

  /** Produce ~`count` rounded price ticks across the axis. */
  ticks(count = 6): number[] {
    const out: number[] = [];
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const v = this.logLow + t * (this.logHigh - this.logLow);
      out.push(this.useLog ? Math.exp(v) : v);
    }
    return out;
  }
}

/** Maps candle indices to horizontal pixels within a plot rect. */
export class IndexAxis {
  readonly step: number;

  constructor(
    readonly count: number,
    private readonly plot: Rect,
  ) {
    this.step = count > 0 ? plot.width / count : plot.width;
  }

  /** Centre x of candle `i`. */
  x(i: number): number {
    return this.plot.x + (i + 0.5) * this.step;
  }

  /** x pixel -> nearest candle index. */
  index(x: number): number {
    const i = Math.floor((x - this.plot.x) / (this.step || 1));
    return Math.min(Math.max(i, 0), Math.max(this.count - 1, 0));
  }

  /** Candle body width in pixels, leaving a small gap. */
  get bodyWidth(): number {
    return Math.max(1, this.step * 0.7);
  }
}

export function formatPrice(p: number): string {
  if (!Number.isFinite(p)) return "—";
  if (p >= 1000) return p.toFixed(0);
  if (p >= 1) return p.toFixed(2);
  return p.toFixed(4);
}

export function formatVolume(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e9) return (v / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (v / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return v.toFixed(0);
}

export function formatDate(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  return d.toISOString().slice(0, 10);
}
