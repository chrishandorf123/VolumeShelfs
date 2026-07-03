/**
 * Group strength: leaders cluster in leading groups. Aggregates the scan's
 * per-ticker reads into a ranked sector board — breadth (share in uptrends),
 * average relative strength and average score per sector — so the user hunts
 * where the market's money already is, and avoids stacking correlated bets.
 */
export interface SectorInput {
  ticker: string;
  sector: string;
  /** 3-month excess return vs the benchmark (fraction). */
  rsExcess: number;
  trendPass: boolean;
  score: number;
}

export interface SectorRow {
  sector: string;
  n: number;
  /** Share of the sector's names passing the trend gate (0..1). */
  breadth: number;
  avgRs: number;
  avgScore: number;
  /** Top tickers by score inside the sector. */
  leaders: string[];
}

/** Ranked best-first: breadth, then relative strength. Singletons sink. */
export function sectorStrength(items: SectorInput[], minGroup = 2): SectorRow[] {
  const groups = new Map<string, SectorInput[]>();
  for (const it of items) {
    const arr = groups.get(it.sector) ?? [];
    arr.push(it);
    groups.set(it.sector, arr);
  }
  const rows: SectorRow[] = [];
  for (const [sector, arr] of groups) {
    if (arr.length < minGroup) continue;
    const finiteRs = arr.map((a) => a.rsExcess).filter((v) => Number.isFinite(v));
    rows.push({
      sector,
      n: arr.length,
      breadth: arr.filter((a) => a.trendPass).length / arr.length,
      avgRs: finiteRs.length ? finiteRs.reduce((x, y) => x + y, 0) / finiteRs.length : 0,
      avgScore: arr.reduce((x, y) => x + y.score, 0) / arr.length,
      leaders: [...arr].sort((a, b) => b.score - a.score).slice(0, 3).map((a) => a.ticker),
    });
  }
  return rows.sort((a, b) => {
    if (a.breadth !== b.breadth) return b.breadth - a.breadth;
    return b.avgRs - a.avgRs;
  });
}
