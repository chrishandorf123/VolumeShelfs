import type { Confirmation, ConfluenceScore, DualThesis, ThesisCase } from "./core";

const TIER_NAME: Record<number, string> = {
  1: "Confluence",
  2: "Trigger",
  3: "Volume",
  4: "Momentum",
  5: "Market / RS",
  6: "Exhaustion",
};

/** The scoreable 10-item confluence checklist (Wujastyk's full tiered gate). */
export function confluencePanelHtml(cf: ConfluenceScore): string {
  const rows = cf.items
    .map(
      (it) =>
        `<div class="cf-item ${it.pass ? "on" : "off"}">
          <span class="cf-dot"></span>
          <span class="cf-tier">T${it.tier}</span>
          <span class="cf-label">${esc(it.label)}</span>
          <span class="cf-detail">${esc(it.detail)}</span>
        </div>`,
    )
    .join("");
  const flag = cf.chasing
    ? `<span class="cf-flag chase">⚠ chasing (+${cf.distanceSD.toFixed(1)} SD)</span>`
    : cf.reversionIntoStrength
      ? `<span class="cf-flag edge">★ reversion-into-strength</span>`
      : "";
  return `<div class="panel confluence-panel">
    <div class="cf-head">
      <h2 data-glossary="confluence-score" title="Wujastyk's scoreable confirmation checklist. Click to learn">Confluence scorecard</h2>
      <span class="cf-grade grade-${cf.grade.replace("+", "plus")}">${cf.grade} · ${cf.passed}/${cf.total}</span>
    </div>
    ${flag}
    <p class="cf-verdict">${esc(cf.verdict)}</p>
    <div class="cf-tiers muted">${Object.entries(TIER_NAME).map(([t, name]) => `T${t} ${name}`).join(" · ")}</div>
    <div class="cf-list">${rows}</div>
  </div>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function money(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return `$${v >= 100 ? v.toFixed(0) : v.toFixed(2)}`;
}

function caseCard(c: ThesisCase): string {
  const cls = c.direction === "bull" ? "bull" : "bear";
  const label = c.direction === "bull" ? "Bull case" : "Bear case";
  const arrow = c.direction === "bull" ? "▲" : "▼";
  const targets = c.targets.map((t) => money(t)).join(" / ");
  return `<div class="thesis-case ${cls}">
    <div class="thesis-top"><span class="thesis-dir">${arrow} ${label}</span></div>
    <div class="thesis-levels">
      <span class="tl"><span class="k">Trigger</span><span class="v">${money(c.trigger)}</span></span>
      <span class="tl"><span class="k">Targets</span><span class="v pos">${targets}</span></span>
      <span class="tl"><span class="k">Invalid</span><span class="v neg">${money(c.invalidation)}</span></span>
    </div>
    <p class="thesis-detail">${esc(c.detail)}</p>
  </div>`;
}

/** Bull + bear thesis panel — Wujastyk always frames both directional cases. */
export function thesisPanelHtml(thesis: DualThesis): string {
  return `<div class="panel thesis-panel">
    <h2 data-glossary="thesis" title="Why both a bull and a bear case? Click to learn">Bull &amp; bear thesis</h2>
    ${caseCard(thesis.bull)}
    ${caseCard(thesis.bear)}
  </div>`;
}

/** Secondary-confirmation panel — MACD / RSI / %-range / 5-SMA + his filter. */
export function confirmationPanelHtml(conf: Confirmation): string {
  const rsiCls = conf.rsi.state === "overbought" ? "neg" : conf.rsi.state === "oversold" ? "pos" : "";
  const macdCls = conf.macd.bullish ? "pos" : "neg";
  const pct = Number.isFinite(conf.pctRange) ? `${(conf.pctRange * 100).toFixed(0)}%` : "—";
  const notes = conf.notes.map((n) => `<li>${esc(n)}</li>`).join("");
  const mrs = conf.meanReversionSetup
    ? `<div class="mrs-badge" data-glossary="mean-reversion" title="Wujastyk's published scanner. Click to learn">✓ Mean-reversion-into-strength setup</div>`
    : "";
  return `<div class="panel confirm-panel">
    <h2 data-glossary="confirmation" title="Secondary confirmation. Click to learn">Confirmation (MACD · RSI · % range)</h2>
    ${mrs}
    <div class="summary">
      <div class="stat"><span class="k">MACD</span><span class="v ${macdCls}">${conf.macd.bullish ? "above signal" : "below signal"}${conf.macd.histRising ? " ↑" : ""}</span></div>
      <div class="stat"><span class="k">RSI (14)</span><span class="v ${rsiCls}">${Number.isFinite(conf.rsi.value) ? conf.rsi.value.toFixed(0) : "—"} · ${conf.rsi.state}</span></div>
      <div class="stat"><span class="k">% range</span><span class="v">${pct}</span></div>
      <div class="stat"><span class="k">5-day MA</span><span class="v ${conf.ma5Rising ? "pos" : ""}">${conf.ma5Rising ? "rising" : "flat/falling"}</span></div>
      <div class="stat"><span class="k">OBV</span><span class="v ${conf.obv.bearishDivergence ? "neg" : conf.obv.rising ? "pos" : ""}">${conf.obv.bearishDivergence ? "divergence" : conf.obv.rising ? "rising" : "flat"}</span></div>
    </div>
    <ul class="reco-why confirm-notes">${notes}</ul>
  </div>`;
}
