import type { Recommendation } from "./core";

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** Shared markup for the plain-English verdict panel (used by both tabs). */
export function recoPanelHtml(reco: Recommendation): string {
  const reasons = reco.reasoning.map((x) => `<li>${esc(x)}</li>`).join("");
  return `<div class="panel reco reco-${reco.verdict}">
    <div class="reco-head">
      <span class="reco-verdict" data-glossary="verdict" title="What do the verdicts mean? Click to learn">${reco.label}</span>
      <span class="reco-conf">${reco.confidence} confidence</span>
    </div>
    <p class="reco-headline">${esc(reco.headline)}</p>
    <ul class="reco-why">${reasons}</ul>
    <p class="reco-note">Educational tool, not financial advice — always confirm on your own chart.</p>
  </div>`;
}
