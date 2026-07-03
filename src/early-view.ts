import type { EarlySignal } from "./core";

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** Compact pill for the results table ("73 LOADING"). */
export function earlyPillHtml(sig: EarlySignal | null): string {
  if (!sig) return "<span class='muted'>—</span>";
  const cls = sig.grade.toLowerCase();
  return `<span class="early-pill early-${cls}" title="${esc(sig.headline)}">${sig.score}<small>${sig.grade}</small></span>`;
}

/** Full checklist panel: which stealth tells are firing and why. */
export function earlyPanelHtml(sig: EarlySignal | null): string {
  if (!sig) return "";
  const rows = sig.components
    .map(
      (c) => `<div class="gate-row ${c.pass ? "pass" : "fail"}">
        <span class="dot"></span><span class="gl">${esc(c.label)}</span>
        <span class="gd muted">${esc(c.detail)}</span></div>`,
    )
    .join("");
  return `<div class="panel early-panel"><h2 data-glossary="early-signal" title="Click to learn">🕵️ Early signal ${earlyPillHtml(sig)}</h2>
    <p class="early-head">${esc(sig.headline)}</p>
    ${rows}
    <p class="fc-note muted">These tells precede the crowd's breakout trigger — they are a heads-up to stalk the name, not a buy signal by themselves. The Final Call still decides.</p>
  </div>`;
}
