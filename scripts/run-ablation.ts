/**
 * Footprint-feature ablation runner (research script, not part of the app).
 *
 * Usage: npx vite-node scripts/run-ablation.ts -- <dir-with-yahoo-json>
 * Reads Yahoo v8 chart JSON files (one per symbol), runs the engine's
 * backtest per symbol with footprint features recorded, pools the trades,
 * and prints: the 4-variant walk-forward ablation, the cost stress, the
 * parameter-robustness sweeps and feature incidence. docs/ABLATION.md is
 * written from this output.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_ABLATION_CONFIG,
  DEFAULT_BACKTEST_CONFIG,
  DEFAULT_FOOTPRINT_CONFIG,
  computeFootprint,
  runAblation,
  runBacktest,
  type Candle,
  type FootprintConfig,
  type Trade,
  type VariantMetrics,
} from "../src/core";

const dir = process.argv[process.argv.length - 1];

function loadCandles(file: string): Candle[] {
  const d = JSON.parse(readFileSync(file, "utf8"));
  const r = d.chart.result[0];
  const q = r.indicators.quote[0];
  const out: Candle[] = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const o = q.open[i];
    const h = q.high[i];
    const l = q.low[i];
    const c = q.close[i];
    const v = q.volume[i];
    if ([o, h, l, c, v].every((x) => Number.isFinite(x))) {
      out.push({ time: r.timestamp[i], open: o, high: h, low: l, close: c, volume: v });
    }
  }
  return out;
}

const symbols = readdirSync(dir).filter((f) => f.endsWith(".json"));
const perSymbol: Array<{ symbol: string; candles: Candle[]; trades: Trade[] }> = [];
for (const f of symbols) {
  const candles = loadCandles(join(dir, f));
  const res = runBacktest(candles, DEFAULT_BACKTEST_CONFIG);
  perSymbol.push({ symbol: f.replace(".json", ""), candles, trades: res.trades });
}
const allTrades = perSymbol.flatMap((s) => s.trades);
console.log(`symbols=${perSymbol.length} bars=${perSymbol.reduce((a, s) => a + s.candles.length, 0)} trades=${allTrades.length}`);

// Feature incidence at signal bars (sample-size reality check).
const absOn = allTrades.filter((t) => t.footprint.absorptionBull).length;
const avOn = allTrades.filter((t) => t.footprint.reclaim || t.footprint.reclaimHold || t.footprint.defense).length;
console.log(`incidence: absorptionBull=${absOn} (${((absOn / allTrades.length) * 100).toFixed(1)}%) avwapEvent=${avOn} (${((avOn / allTrades.length) * 100).toFixed(1)}%)`);

function fmt(m: VariantMetrics): string {
  const pf = Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : "∞";
  return [
    m.variant.padEnd(10),
    `taken=${String(m.taken).padStart(4)}/${m.offered}`,
    `expR=${m.expectancyR >= 0 ? "+" : ""}${m.expectancyR.toFixed(3)}`,
    `hit=${(m.hitRate * 100).toFixed(1)}%`,
    `W/L=${m.avgWinR.toFixed(2)}/${m.avgLossR.toFixed(2)}`,
    `PF=${pf}`,
    `maxDD=${m.maxDrawdownR.toFixed(1)}R`,
    `P(hit|on)=${(m.pFeatureOn * 100).toFixed(1)}% [${(m.ciFeatureOn[0] * 100).toFixed(1)}–${(m.ciFeatureOn[1] * 100).toFixed(1)}] n=${m.nFeatureOn}`,
    `base=${(m.pAll * 100).toFixed(1)}%`,
  ].join("  ");
}

for (const costMult of [1, 1.5, 2]) {
  console.log(`\n== walk-forward OOS · cost=${costMult}× (${DEFAULT_ABLATION_CONFIG.costBps * costMult}bps/side) ==`);
  for (const m of runAblation(allTrades, DEFAULT_ABLATION_CONFIG, DEFAULT_ABLATION_CONFIG.costBps * costMult)) {
    console.log(fmt(m));
  }
}

// ---- parameter-robustness sweeps -------------------------------------------
/** Re-tag every trade's footprint under a different config (signal bar = entryIndex−1). */
function retag(cfg: FootprintConfig): Trade[] {
  const out: Trade[] = [];
  for (const s of perSymbol) {
    if (!s.trades.length) continue;
    const fp = computeFootprint(s.candles, cfg);
    for (const t of s.trades) out.push({ ...t, footprint: fp[t.entryIndex - 1] });
  }
  return out;
}

console.log("\n== sweep: absorption (expectancy delta vs baseline, OOS) ==");
console.log("VOL_MULT \\ RANGE_MAX     0.6      0.7      0.8");
for (const volMult of [1.5, 2.0, 2.5]) {
  const cells: string[] = [];
  for (const rangeMax of [0.6, 0.7, 0.8]) {
    const trades = retag({ ...DEFAULT_FOOTPRINT_CONFIG, volMult, rangeMax });
    const [base, absorb] = runAblation(trades, DEFAULT_ABLATION_CONFIG);
    const on = trades.filter((t) => t.footprint.absorptionBull).length;
    cells.push(`${(absorb.expectancyR - base.expectancyR >= 0 ? "+" : "")}${(absorb.expectancyR - base.expectancyR).toFixed(3)}(n${on})`);
  }
  console.log(`${volMult.toFixed(1).padEnd(10)} ${cells.map((c) => c.padStart(12)).join(" ")}`);
}

console.log("\n== sweep: avwapEvent (expectancy delta vs baseline, OOS) ==");
console.log("HOLD_BARS \\ TOUCH_TOL    0.001    0.002    0.004");
for (const holdBars of [1, 2, 3]) {
  const cells: string[] = [];
  for (const touchTol of [0.001, 0.002, 0.004]) {
    const trades = retag({ ...DEFAULT_FOOTPRINT_CONFIG, holdBars, touchTol });
    const res = runAblation(trades, DEFAULT_ABLATION_CONFIG);
    const base = res[0];
    const av = res[2];
    const on = trades.filter((t) => t.footprint.reclaim || t.footprint.reclaimHold || t.footprint.defense).length;
    cells.push(`${(av.expectancyR - base.expectancyR >= 0 ? "+" : "")}${(av.expectancyR - base.expectancyR).toFixed(3)}(n${on})`);
  }
  console.log(`${String(holdBars).padEnd(10)} ${cells.map((c) => c.padStart(12)).join(" ")}`);
}

// ---- per-bucket context for the report --------------------------------------
console.log("\n== pooled per-bucket stats (in-sample context, not the OOS test) ==");
for (const b of ["A", "B", "C", "D"] as const) {
  const tr = allTrades.filter((t) => t.bucket === b);
  const k = tr.filter((t) => t.hitT1).length;
  const avgR = tr.length ? tr.reduce((s, t) => s + t.rMultiple, 0) / tr.length : 0;
  const av = tr.filter((t) => t.footprint.reclaim || t.footprint.reclaimHold || t.footprint.defense);
  const kAv = av.filter((t) => t.hitT1).length;
  console.log(
    `${b}: n=${String(tr.length).padStart(3)} hitT1=${tr.length ? ((k / tr.length) * 100).toFixed(1) : "—"}% avgR=${avgR >= 0 ? "+" : ""}${avgR.toFixed(3)}` +
      `   avwapEvent-on: n=${av.length} hit=${av.length ? ((kAv / av.length) * 100).toFixed(1) : "—"}%`,
  );
}
const years = allTrades.length
  ? `${new Date(Math.min(...allTrades.map((t) => t.entryTime)) * 1000).toISOString().slice(0, 10)} → ${new Date(Math.max(...allTrades.map((t) => t.entryTime)) * 1000).toISOString().slice(0, 10)}`
  : "—";
console.log(`trade window: ${years}`);
