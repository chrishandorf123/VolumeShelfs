/**
 * Sector-rotation engine — the standard Relative Rotation Graph (RRG) math
 * (Julius de Kempenaer's JdK RS-Ratio / RS-Momentum), computed on weekly bars
 * per convention. See docs/RESEARCH.md → "Sector rotation detection" for the
 * method, quadrant semantics and the evidence base.
 *
 * The read: sectors travel CLOCKWISE through Improving → Leading → Weakening
 * → Lagging. Improving→Leading = money rotating IN; Leading→Weakening is the
 * first crack of money rotating OUT. Momentum (y) leads ratio (x).
 */
import type { Candle } from "./types";

export type Quadrant = "leading" | "weakening" | "lagging" | "improving";

export interface RotationPoint {
  /** JdK RS-Ratio: >100 = relative uptrend vs the benchmark. */
  ratio: number;
  /** JdK RS-Momentum: >100 = that relative trend is accelerating. */
  momentum: number;
}

export interface SectorRotation {
  symbol: string;
  label: string;
  quadrant: Quadrant;
  point: RotationPoint;
  /** Recent trail, oldest → newest (including the current point). */
  trail: RotationPoint[];
  /** Heading in degrees (0 = due east/gaining ratio, 90 = due north). NaN with <2 points. */
  headingDeg: number;
  /** Quadrant K weeks ago (start of the trail) — where it came FROM. */
  cameFrom: Quadrant;
  /** Weeks since the sector last changed quadrant (0 = crossed this week). */
  weeksInQuadrant: number;
  /** Relative return vs benchmark over ~1 month (4w) and ~3 months (13w). */
  rel1m: number;
  rel3m: number;
}

export interface RotationRead {
  sectors: SectorRotation[];
  /** Plain-English digest: where money is rotating in/out, right now. */
  digest: string[];
  /** True when there wasn't enough overlapping history for a full read. */
  thin: boolean;
}

// ---- math helpers -----------------------------------------------------------

/** EMA of a series (alpha = 2/(n+1)), NaN until the first value. */
function ema(xs: number[], n: number): number[] {
  const a = 2 / (n + 1);
  const out = new Array<number>(xs.length).fill(NaN);
  let prev = NaN;
  for (let i = 0; i < xs.length; i++) {
    const v = xs[i];
    if (!Number.isFinite(v)) continue;
    prev = Number.isFinite(prev) ? a * v + (1 - a) * prev : v;
    out[i] = prev;
  }
  return out;
}

/** 100 + 10 × rolling z-score of xs against its own mean/σ over `win`. */
function jdkNormalize(xs: number[], win: number): number[] {
  const out = new Array<number>(xs.length).fill(NaN);
  for (let i = win - 1; i < xs.length; i++) {
    const w = xs.slice(i - win + 1, i + 1).filter(Number.isFinite);
    if (w.length < win) continue;
    const mean = w.reduce((a, b) => a + b, 0) / w.length;
    const sd = Math.sqrt(w.reduce((a, b) => a + (b - mean) ** 2, 0) / w.length);
    out[i] = sd > 0 ? 100 + 10 * ((xs[i] - mean) / sd) : 100;
  }
  return out;
}

export function quadrantOf(p: RotationPoint): Quadrant {
  if (p.ratio >= 100) return p.momentum >= 100 ? "leading" : "weakening";
  return p.momentum >= 100 ? "improving" : "lagging";
}

export const QUADRANT_LABEL: Record<Quadrant, string> = {
  leading: "Leading",
  weakening: "Weakening",
  lagging: "Lagging",
  improving: "Improving",
};

/** Align two weekly series on their common tail; returns [sector, benchmark]. */
function alignTails(a: Candle[], b: Candle[]): [Candle[], Candle[]] {
  const n = Math.min(a.length, b.length);
  return [a.slice(a.length - n), b.slice(b.length - n)];
}

/**
 * RRG series for ONE sector vs the benchmark (weekly candles).
 * Window = 14 weeks (the JdK default period).
 */
export function rrgSeries(sector: Candle[], benchmark: Candle[], win = 14): RotationPoint[] {
  const [s, b] = alignTails(sector, benchmark);
  if (s.length < win * 2 + 2) return [];
  const rs = s.map((c, i) => (b[i].close > 0 ? c.close / b[i].close : NaN));
  const smoothed = ema(rs, win);
  const ratio = jdkNormalize(smoothed, win);
  // Momentum: normalized rate of change of the ratio line (1-week ROC).
  const roc = ratio.map((v, i) =>
    i > 0 && Number.isFinite(v) && Number.isFinite(ratio[i - 1]) && ratio[i - 1] !== 0
      ? (v / ratio[i - 1]) * 100
      : NaN,
  );
  const momentum = jdkNormalize(roc, win);
  const pts: RotationPoint[] = [];
  for (let i = 0; i < ratio.length; i++) {
    if (Number.isFinite(ratio[i]) && Number.isFinite(momentum[i])) {
      pts.push({ ratio: ratio[i], momentum: momentum[i] });
    }
  }
  return pts;
}

/** Relative return vs benchmark over the last `k` weekly bars. */
function relReturn(sector: Candle[], benchmark: Candle[], k: number): number {
  const [s, b] = alignTails(sector, benchmark);
  if (s.length < k + 1) return NaN;
  const sr = s[s.length - 1].close / s[s.length - 1 - k].close - 1;
  const br = b[b.length - 1].close / b[b.length - 1 - k].close - 1;
  return sr - br;
}

/**
 * Full rotation read for a set of sectors vs the benchmark (weekly candles).
 * trailLen = how many weekly points to keep for the on-chart trail.
 */
export function rotationRead(
  sectors: Array<{ symbol: string; label: string; weekly: Candle[] }>,
  benchmarkWeekly: Candle[],
  trailLen = 8,
): RotationRead {
  const out: SectorRotation[] = [];
  let thin = false;
  for (const s of sectors) {
    const pts = rrgSeries(s.weekly, benchmarkWeekly);
    if (pts.length < 2) {
      thin = true;
      continue;
    }
    const trail = pts.slice(-trailLen);
    const now = trail[trail.length - 1];
    const quadrant = quadrantOf(now);
    // Walk back to find the last quadrant change.
    let weeksIn = 0;
    for (let i = pts.length - 2; i >= 0 && quadrantOf(pts[i]) === quadrant; i--) weeksIn++;
    const prev = trail[trail.length - 2];
    const headingDeg = (Math.atan2(now.momentum - prev.momentum, now.ratio - prev.ratio) * 180) / Math.PI;
    out.push({
      symbol: s.symbol,
      label: s.label,
      quadrant,
      point: now,
      trail,
      headingDeg,
      cameFrom: quadrantOf(trail[0]),
      weeksInQuadrant: weeksIn,
      rel1m: relReturn(s.weekly, benchmarkWeekly, 4),
      rel3m: relReturn(s.weekly, benchmarkWeekly, 13),
    });
  }
  // Rank: Leading first (by ratio), then Improving (momentum — the rotations
  // forming), then Weakening, then Lagging.
  const rank: Record<Quadrant, number> = { leading: 0, improving: 1, weakening: 2, lagging: 3 };
  out.sort((a, b) => rank[a.quadrant] - rank[b.quadrant] || b.point.ratio - a.point.ratio);
  return { sectors: out, digest: buildDigest(out), thin };
}

/** The plain-English "where is the money going" read. */
function buildDigest(sectors: SectorRotation[]): string[] {
  const lines: string[] = [];
  const fresh = (s: SectorRotation) => s.weeksInQuadrant <= 2;
  const into = sectors.filter((s) => s.quadrant === "leading" && fresh(s) && s.cameFrom !== "leading");
  const forming = sectors.filter((s) => s.quadrant === "improving");
  const cracking = sectors.filter((s) => s.quadrant === "weakening" && fresh(s));
  const leaders = sectors.filter((s) => s.quadrant === "leading");

  if (into.length) {
    lines.push(
      `🟢 Money is rotating INTO ${into.map((s) => s.label).join(", ")} — just crossed into Leading. Hunt longs here first.`,
    );
  } else if (leaders.length) {
    lines.push(
      `🟢 Current leadership: ${leaders.map((s) => s.label).join(", ")}. Established — favor these groups while they hold the quadrant.`,
    );
  }
  if (forming.length) {
    lines.push(
      `🌀 Rotation FORMING in ${forming.map((s) => s.label).join(", ")} — momentum turned up while still under-owned (Improving). Earliest entries live here; confirm with breadth below.`,
    );
  }
  if (cracking.length) {
    lines.push(
      `⚠️ First crack in ${cracking.map((s) => s.label).join(", ")} — still strong but momentum just rolled over (Weakening). Tighten stops on longs in these groups; money rotates OUT from here.`,
    );
  }
  if (!lines.length) {
    lines.push("No fresh rotation this week — quadrants unchanged. Trade the existing leaders and let the map update weekly.");
  }
  return lines;
}
