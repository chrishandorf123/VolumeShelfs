import type { Cell, ModelRecommendation, Tables, BacktestResult } from "./core";
import { formatPrice } from "./chart/scale";

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
function pct(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(0)}%`;
}
function pct1(v: number): string {
  return Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : "—";
}

const ACTION_META: Record<ModelRecommendation["action"], { label: string; icon: string; cls: string }> = {
  TAKE: { label: "TAKE", icon: "▲", cls: "take" },
  WATCH: { label: "WATCH", icon: "●", cls: "watch" },
  STAND_ASIDE: { label: "STAND ASIDE", icon: "⊘", cls: "aside" },
};

/** The backtest-driven decision panel: verdict banner, trade card, bucket table. */
export function modelPanelHtml(rec: ModelRecommendation, tables: Tables, result: BacktestResult): string {
  const a = ACTION_META[rec.action];
  const acct = Number(localStorage.getItem("vs.acct")) || 10000;
  const perShare = rec.entry !== null && rec.stop !== null ? rec.entry - rec.stop : NaN;
  const shares = rec.riskFrac > 0 && perShare > 0 ? Math.floor((acct * rec.riskFrac) / perShare) : 0;

  const card =
    rec.action === "STAND_ASIDE"
      ? `<p class="model-why">${esc(rec.rationale)}</p>`
      : `<div class="model-card">
          <div class="summary">
            <div class="stat"><span class="k">Entry</span><span class="v">${formatPrice(rec.entry!)}</span></div>
            <div class="stat"><span class="k">Stop</span><span class="v neg">${formatPrice(rec.stop!)}</span></div>
            <div class="stat"><span class="k">T1 · break-even</span><span class="v pos">${formatPrice(rec.t1!)}</span></div>
            <div class="stat"><span class="k">T2 · travel lane</span><span class="v pos">${rec.t2 !== null ? formatPrice(rec.t2) : "—"}</span></div>
            <div class="stat"><span class="k">Reward : risk</span><span class="v">${rec.rr !== null ? rec.rr.toFixed(2) : "—"}</span></div>
            <div class="stat"><span class="k">Size</span><span class="v">${pct1(rec.riskFrac)} equity · ${shares} sh</span></div>
          </div>
          <p class="model-hist">Historical: <b>${pct(rec.hitRateT1)}</b> reverted to break-even
            <span class="model-n ${rec.n < 30 ? "thin" : ""}">(N=${rec.n}, 95% CI ${pct(rec.ciT1?.[0])}–${pct(rec.ciT1?.[1])})</span>
            vs <b>${pct(rec.baseRate)}</b> base rate · regime ${esc(rec.regime)}.</p>
          <p class="model-size muted">Size: ${esc(rec.bindingConstraint)}${rec.maeConflict ? " · ⚠ typical heat exceeds the stop" : ""}.</p>
          <p class="model-why">${esc(rec.rationale)}</p>
        </div>`;

  return `<div class="panel model-panel">
    <div class="model-banner ${a.cls}"><span class="mb-icon">${a.icon}</span><span class="mb-label">${a.label}</span>
      <span class="mb-sub">${esc(rec.regime)}${rec.bucket ? ` · bucket ${rec.bucket}` : ""}</span></div>
    ${card}
    <details class="model-table">
      <summary>Backtested probability table (this symbol)</summary>
      ${bucketTableHtml(tables)}
      <p class="model-meta muted">${result.trades.length} trades over ${result.usableBars} usable bars (${pct1(result.candidateFraction)} candidates).
        ${result.notes.map(esc).join(" ")}</p>
    </details>
    <p class="model-disclaimer">Research tool. Single-symbol, client-side historical probabilities — not predictions. Survivorship-unadjusted; the model can be wrong and regimes shift. Not financial advice.</p>
  </div>`;
}

function bucketTableHtml(tables: Tables): string {
  const row = (c: Cell) => {
    const thin = c.n < 30;
    const edge = c.n > 0 ? c.hitRateT1 - c.baseRate : 0;
    return `<tr class="${thin ? "thin" : ""} ${c.edgeOverBase ? "edge" : ""}">
      <td><b>${c.bucket === "ALL" ? "All" : c.bucket}</b></td>
      <td>${c.n}</td>
      <td>${pct(c.hitRateT1)}<small> (${pct(c.ciT1[0])}–${pct(c.ciT1[1])})</small></td>
      <td>${pct(c.baseRate)}</td>
      <td class="${edge > 0 ? "pos" : "neg"}">${edge >= 0 ? "+" : ""}${(edge * 100).toFixed(0)}</td>
      <td>${c.avgR.toFixed(2)}</td>
      <td>${pct(c.maeP75)}</td>
      <td>${c.medianBarsToT1 ?? "—"}</td>
    </tr>`;
  };
  const legend = `<tr class="model-head"><td>z-bucket</td><td>N</td><td>Hit→T1 (95% CI)</td><td>Base</td><td>Edge</td><td>Avg R</td><td>P75 MAE</td><td>Bars</td></tr>`;
  return `<table class="model-tbl">${legend}${tables.byBucket.map(row).join("")}</table>
    <p class="muted model-hint">Buckets by |z| below break-even: A 0–1σ · B 1–2σ · C 2–3σ · D &gt;3σ. An edge only counts when the CI lower bound clears the base rate (green rows); thin (N&lt;30) rows are greyed.</p>`;
}
