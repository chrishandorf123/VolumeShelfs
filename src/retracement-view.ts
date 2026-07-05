import type { RetracementRead } from "./core";
import { formatPrice } from "./chart/scale";

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

const VERDICT_META: Record<RetracementRead["verdict"], { label: string; cls: string; icon: string }> = {
  "no-pullback": { label: "AT HIGHS", cls: "rtc-none", icon: "▲" },
  retracement: { label: "RETRACEMENT", cls: "rtc-good", icon: "↩" },
  warning: { label: "MIXED", cls: "rtc-warn", icon: "⚠" },
  "reversal-risk": { label: "REVERSAL RISK", cls: "rtc-bad", icon: "⛔" },
};

/** Dip grader panel: is this pullback a buyable retracement or a reversal? */
export function retracementPanelHtml(read: RetracementRead | null, price: number): string {
  if (!read) {
    return `<div class="panel"><h2 data-glossary="retracement" title="Retracement vs reversal — click to learn">Dip grader</h2>
      <div class="empty">No recent impulse leg big enough to grade (needs a ≥6% swing).</div></div>`;
  }
  const m = VERDICT_META[read.verdict];
  const rows: Array<[string, number]> = [
    ["Impulse high", read.fib.high],
    ["38.2%", read.fib.fib382],
    ["50%", read.fib.fib500],
    ["61.8%", read.fib.fib618],
    ["78.6% (invalidation)", read.fib.fib786],
    ["Impulse low", read.fib.low],
  ];
  // Mark the rung price currently sits between.
  const ladder = rows
    .map(([label, lvl], i) => {
      const next = rows[i + 1]?.[1] ?? -Infinity;
      const here = price <= lvl && price > next;
      return `<div class="rtc-rung ${here ? "here" : ""} ${label.startsWith("78.6") ? "danger" : ""}">
        <span class="rtc-lbl">${esc(label)}</span><span class="rtc-price">${formatPrice(lvl)}</span>${here ? '<span class="rtc-you">◀ price</span>' : ""}</div>`;
    })
    .join("");
  const stats = [
    `${(read.depth * 100).toFixed(0)}% retraced`,
    Number.isFinite(read.volumeRatio) ? `pullback vol ${(read.volumeRatio * 100).toFixed(0)}% of impulse` : null,
    `${read.pullbackBars} bars down vs ${read.impulseBars} up`,
  ].filter(Boolean);
  return `<div class="panel rtc-panel">
    <h2 data-glossary="retracement" title="Retracement vs reversal — click to learn">Dip grader <span class="muted">retracement or reversal?</span></h2>
    <div class="rtc-verdict ${m.cls}"><span class="rtc-icon">${m.icon}</span><b>${m.label}</b></div>
    <p class="rtc-head">${esc(read.headline)}</p>
    <div class="rtc-stats muted">${stats.map((s) => `<span>${esc(s!)}</span>`).join(" · ")}</div>
    <div class="rtc-ladder">${ladder}</div>
    <ul class="notes">${read.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
  </div>`;
}
