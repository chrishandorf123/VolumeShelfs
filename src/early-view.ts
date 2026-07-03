import type { EarlySignal, SignalProof } from "./core";

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/**
 * Per-symbol historical validation of the Early Signal — a point-in-time
 * replay over this name's own chart, signal bars vs baseline. Honest output:
 * when the signal did NOT lead here, it says so.
 */
export function proofPanelHtml(proof: SignalProof | null): string {
  if (!proof) return "";
  const pct = (v: number) => (Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%` : "—");
  if (proof.nSignal < 8) {
    return `<div class="panel"><h2>📜 Signal proof <span class="muted">(this symbol's history)</span></h2>
      <div class="empty">Only ${proof.nSignal} historical LOADING-grade bars here — not enough samples to judge the signal on this name.</div></div>`;
  }
  const leads = proof.medianFwdSignal > proof.medianFwdBase && proof.hitRateSignal >= proof.hitRateBase;
  const verdict = leads
    ? `<p class="proof-verdict pos">✓ On this name's own history, the signal led: better median forward move and a higher +5% hit rate than random bars.</p>`
    : `<p class="proof-verdict neg">✗ The signal has NOT outperformed baseline on this name's history — trust it less here.</p>`;
  return `<div class="panel"><h2>📜 Signal proof <span class="muted">(this symbol's history)</span></h2>
    <div class="summary">
      <div class="stat"><span class="k">Signal bars (score ≥ ${proof.minScore})</span><span class="v">${proof.nSignal} of ${proof.n}</span></div>
      <div class="stat"><span class="k">Median ${proof.fwdBars}-bar move · signal</span><span class="v ${proof.medianFwdSignal >= 0 ? "pos" : "neg"}">${pct(proof.medianFwdSignal)}</span></div>
      <div class="stat"><span class="k">Median ${proof.fwdBars}-bar move · baseline</span><span class="v">${pct(proof.medianFwdBase)}</span></div>
      <div class="stat"><span class="k">+5% hit rate · signal vs base</span><span class="v">${Number.isFinite(proof.hitRateSignal) ? (proof.hitRateSignal * 100).toFixed(0) : "—"}% vs ${(proof.hitRateBase * 100).toFixed(0)}%</span></div>
    </div>
    ${verdict}
    <p class="fc-note muted">Point-in-time replay (each historical bar sees only its own past). Past behaviour on one symbol, not a guarantee.</p>
  </div>`;
}

/** Compact pill for the results table ("73 LOADING"). */
export function earlyPillHtml(sig: EarlySignal | null): string {
  if (!sig) return "<span class='muted'>—</span>";
  const cls = sig.grade.toLowerCase();
  return `<span class="early-pill early-${cls}" title="${esc(sig.headline)}">${sig.score}<small>${sig.grade}</small></span>`;
}

/** Full checklist panel: which stealth tells are firing and why. */
export function earlyPanelHtml(sig: EarlySignal | null, weekly?: EarlySignal | null): string {
  if (!sig) return "";
  const rows = sig.components
    .map(
      (c) => `<div class="gate-row ${c.pass ? "pass" : "fail"}">
        <span class="dot"></span><span class="gl">${esc(c.label)}</span>
        <span class="gd muted">${esc(c.detail)}</span></div>`,
    )
    .join("");
  // The higher timeframe seeing the same thing is the strongest version of early.
  const weeklyChip =
    weekly && weekly.grade !== "QUIET"
      ? `<span class="early-pill early-${weekly.grade.toLowerCase()}" title="The WEEKLY chart shows the same stealth tells — accumulation on the higher timeframe leads by weeks, not days.">WK ${weekly.grade}</span>`
      : "";
  return `<div class="panel early-panel"><h2 data-glossary="early-signal" title="Click to learn">🕵️ Early signal ${earlyPillHtml(sig)} ${weeklyChip}</h2>
    <p class="early-head">${esc(sig.headline)}</p>
    ${rows}
    <p class="fc-note muted">These tells precede the crowd's breakout trigger — they are a heads-up to stalk the name, not a buy signal by themselves. The Final Call still decides.</p>
  </div>`;
}
