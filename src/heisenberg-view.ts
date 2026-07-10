import type { HeisenbergRead, HbSetup } from "./core";

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

const CALL_META: Record<HeisenbergRead["call"], { cls: string; icon: string; label: string }> = {
  "TAKE-LONG": { cls: "hb-take", icon: "🐱", label: "HE'D TAKE IT — LONG" },
  "TAKE-SHORT": { cls: "hb-short", icon: "🎈", label: "HE'D FADE IT — SHORT (small)" },
  STRANGLE: { cls: "hb-coil", icon: "🌀", label: "HE'D STRANGLE IT" },
  WAIT: { cls: "hb-wait", icon: "⏳", label: "HE'D WAIT" },
  PASS: { cls: "hb-pass", icon: "🚶", label: "HE'D PASS" },
};

function setupRows(setup: HbSetup): string {
  return setup.checks
    .map(
      (c) => `<div class="gate-row ${c.pass ? "pass" : "fail"}">
        <span class="dot"></span><span class="gl">${esc(c.label)}</span>
        <span class="gd muted">${esc(c.detail)}</span></div>`,
    )
    .join("");
}

/**
 * "Would Heisenberg take this trade?" — the @Mr_Derivatives playbook applied
 * to the loaded symbol. See docs/MR_DERIVATIVES.md for the receipts.
 */
export function heisenbergPanelHtml(read: HeisenbergRead | null, why?: string): string {
  if (!read) {
    return `<div class="panel hb-panel"><h2>Heisenberg check 🧪</h2>
      <div class="empty">${esc(why ?? "Needs ≥60 daily bars — switch Interval to Daily and load more history.")}</div></div>`;
  }
  const m = CALL_META[read.call];
  const s = read.signals;

  const analogs =
    s.rsiAnalogs.length && (s.rsi < 40 || s.rsi > 60)
      ? `<p class="hb-analog">His "we are due" stat — the last ${s.rsiAnalogs.length} time${s.rsiAnalogs.length > 1 ? "s" : ""} RSI was this ${
          s.rsi <= 50 ? "oversold" : "overbought"
        }, the ${s.rsi <= 50 ? "bounce" : "pullback"} that followed: ${s.rsiAnalogs
          .map((a) => `${(a.movePct * 100).toFixed(0)}%`)
          .join(", ")} <span class="muted">(next-15-bar best move; sample-of-few, not an edge)</span></p>`
      : "";

  const plan = read.plan
    ? `<div class="hb-plan">
        <div class="hb-plan-row"><b>Entry</b><span>${read.plan.entry.toFixed(2)} (${read.plan.side})</span></div>
        <div class="hb-plan-row"><b>Stop</b><span>${read.plan.stop.toFixed(2)} — structural, just past the level in play</span></div>
        <div class="hb-plan-row"><b>Targets</b><span>${read.plan.targets.map((t) => esc(t.label)).join(" → ")}</span></div>
        ${read.plan.rrT1 !== null ? `<div class="hb-plan-row"><b>R:R to T1</b><span>${read.plan.rrT1.toFixed(1)}:1</span></div>` : ""}
        <div class="hb-plan-row"><b>Size</b><span>${esc(read.sizing)}</span></div>
      </div>`
    : `<p class="muted hb-nosize">${esc(read.sizing)}</p>`;

  const best = read.best
    ? `<h3 class="hb-setup-name">${esc(read.best.name)} <span class="muted">(${Math.round(read.best.score * 100)}% of triggers lit)</span></h3>
       ${setupRows(read.best)}
       <blockquote class="hb-quote">&ldquo;${esc(read.best.quote.text)}&rdquo; <cite>— @Mr_Derivatives, ${esc(read.best.quote.date)}</cite></blockquote>`
    : "";

  const others = read.setups
    .filter((x) => x.triggered && x.key !== read.best?.key)
    .map((x) => esc(x.name))
    .join(" · ");

  return `<div class="panel hb-panel ${m.cls}">
    <h2>Heisenberg check 🧪 <span class="hb-sub">would @Mr_Derivatives take this trade?</span></h2>
    <div class="hb-banner"><span class="hb-icon">${m.icon}</span><span class="hb-call">${m.label}</span></div>
    <p class="hb-headline">${esc(read.headline)}</p>
    ${read.daringSouls ? `<p class="hb-daring">⚡ ${esc(read.daringSouls)}</p>` : ""}
    ${analogs}
    ${best}
    ${others ? `<p class="muted hb-others">Also firing: ${others}</p>` : ""}
    ${plan}
    ${read.vixGate ? `<p class="hb-vix">${esc(read.vixGate.note)}</p>` : `<p class="muted hb-vix">VIX gate unchecked — his regime dial needs a VIX quote (buy elevated / sell depressed).</p>`}
    <p class="hb-caveat muted">${esc(read.caveat)} Reconstructed from his tweets — see docs/MR_DERIVATIVES.md. Not his actual opinion, and not financial advice.</p>
  </div>`;
}
