import type { DisciplineReport, FinalCall, MarketRegime } from "./core";

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

const CALL_META: Record<FinalCall["call"], { cls: string; icon: string }> = {
  GO: { cls: "fc-go", icon: "🚀" },
  "GO-HALF": { cls: "fc-half", icon: "⚡" },
  WAIT: { cls: "fc-wait", icon: "⏳" },
  "NO-GO": { cls: "fc-nogo", icon: "⛔" },
};

/** THE decision banner — one call, the binding reason, everything else below it. */
export function finalCallPanelHtml(fc: FinalCall): string {
  const m = CALL_META[fc.call];
  const reasons = fc.reasons.length
    ? `<ul class="fc-reasons">${fc.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>`
    : "";
  return `<div class="panel final-call ${m.cls}">
    <div class="fc-banner">
      <span class="fc-icon">${m.icon}</span>
      <span class="fc-call">${fc.call}</span>
      <span class="fc-side ${fc.side}">${fc.side.toUpperCase()}</span>
      ${fc.sizeFactor > 0 && fc.sizeFactor < 1 ? '<span class="fc-size">½ size</span>' : ""}
    </div>
    <p class="fc-headline">${esc(fc.headline)}</p>
    ${reasons}
    <p class="fc-note muted">One call, strictest signal wins — merged from the setup verdict, stage, weekly/daily alignment, confluence and the discipline guard.</p>
  </div>`;
}

/** The survival rules, checked live against the account + journal + regime. */
export function disciplinePanelHtml(rep: DisciplineReport): string {
  const rows = rep.checks
    .map(
      (c) => `<div class="gate-row ${c.level === "pass" ? "pass" : c.level === "warn" ? "warn" : "fail"}">
        <span class="dot"></span><span class="gl">${esc(c.label)}</span>
        <span class="gd muted">${esc(c.message)}</span></div>`,
    )
    .join("");
  const chip =
    rep.verdict === "go"
      ? '<span class="disc-chip ok">all clear</span>'
      : rep.verdict === "caution"
        ? `<span class="disc-chip warn">caution · ${rep.sizeFactor === 0.5 ? "half size" : "check flags"}</span>`
        : '<span class="disc-chip bad">blocked</span>';
  return `<div class="panel"><h2 data-glossary="portfolio-heat" title="Click to learn">Discipline guard ${chip}</h2>${rows}</div>`;
}

/** Market traffic light for the scanner header. */
export function regimeChipHtml(regime: MarketRegime): string {
  const label = regime.light.toUpperCase();
  return `<span class="regime-chip regime-${regime.light}" title="${esc(regime.detail)}">
    <span class="regime-dot"></span> Market: ${label}${regime.stage ? ` · stage ${regime.stage}` : ""}${regime.weekly !== "neutral" ? ` · wk ${regime.weekly === "up" ? "↑" : "↓"}` : ""}
  </span>`;
}
