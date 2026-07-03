import { openPosition, type TradePlan } from "./core";
import { addPosition } from "./journal-store";
import { formatPrice } from "./chart/scale";

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** Per-share risk regardless of direction (long: entry−stop; short: stop−entry). */
function perShareRisk(plan: TradePlan): number {
  return plan.side === "short" ? plan.stop - plan.entry : plan.entry - plan.stop;
}

/** Shared trade-plan panel (levels, R:R, a risk-based position sizer, notes). */
export function tradePlanPanelHtml(plan: TradePlan | null): string {
  if (!plan) {
    return `<div class="panel"><h2>Trade plan</h2><div class="empty">No support shelf — not actionable as a long.</div></div>`;
  }
  const short = plan.side === "short";
  const lvl = (k: string, v: number, cls = "") =>
    `<div class="stat"><span class="k">${k}</span><span class="v ${cls}">${formatPrice(v)}</span></div>`;
  const notes = plan.notes.map((n) => `<li>${esc(n)}</li>`).join("");
  const t1Label = short ? "T1 (demand below)" : plan.isGapPlay ? "T1 (far shelf)" : "T1 (POC/HVN)";
  const t2Label = short ? "T2 (lower)" : plan.isGapPlay ? "T2 (beyond)" : "T2 (VAH+)";
  const acct = Number(localStorage.getItem("vs.acct")) || 10000;
  const riskPref = Number(localStorage.getItem("vs.riskpref")) || 1;
  const perShare = perShareRisk(plan);
  const shares = perShare > 0 ? Math.floor((acct * riskPref) / 100 / perShare) : 0;
  return `<div class="panel"><h2>${short ? "Short plan · downtrend mirror" : `Trade plan${plan.isGapPlay ? " · gap play" : ""}`}</h2>
    <div class="summary">
      ${lvl(short ? "Entry (breakdown)" : "Entry (reclaim)", plan.entry)}
      ${lvl(short ? "Cover-stop (above shelf)" : "Stop (shelf low)", plan.stop, "neg")}
      ${lvl(t1Label, plan.t1, "pos")}
      ${lvl(t2Label, plan.t2, "pos")}
      <div class="stat"><span class="k">Risk</span><span class="v">${(plan.riskPct * 100).toFixed(1)}%</span></div>
      <div class="stat"><span class="k">R to T1 / T2</span><span class="v">${plan.rMultipleT1.toFixed(1)}R / ${plan.rMultipleT2.toFixed(1)}R</span></div>
    </div>
    <div class="possize">
      <span class="k" data-glossary="r-multiple" title="Risk-based sizing. Click to learn about R">Size <span class="muted">(risk-based)</span></span>
      <label>Acct $ <input class="ps-acct" type="number" min="0" step="100" value="${acct}" /></label>
      <label>Risk % <input class="ps-risk" type="number" min="0" step="0.25" value="${riskPref}" /></label>
      <span class="ps-out">→ <b class="ps-shares">${shares}</b> sh · $<span class="ps-dollar">${(shares * perShare).toFixed(0)}</span> risk</span>
    </div>
    <div class="track-row">
      <button class="ps-track ghost" type="button" title="Log this plan as a position in the journal (Scanner → Positions). Tracks P&L in R against live prices — great for paper-trading the system before risking money.">📌 Track this ${short ? "short" : "trade"}</button>
      <span class="muted track-hint">logs entry/stop/targets · measures the outcome in R</span>
    </div>
    <ul class="notes">${notes}</ul></div>`;
}

/** Wire the position-sizer inputs inside `container` for the given plan. */
export function wirePositionSizer(container: HTMLElement, plan: TradePlan | null): void {
  const acctIn = container.querySelector<HTMLInputElement>(".ps-acct");
  const riskIn = container.querySelector<HTMLInputElement>(".ps-risk");
  if (!acctIn || !riskIn || !plan) return;
  const recalc = () => {
    const acct = Math.max(0, Number(acctIn.value) || 0);
    const risk = Math.max(0, Number(riskIn.value) || 0);
    localStorage.setItem("vs.acct", String(acct));
    localStorage.setItem("vs.riskpref", String(risk));
    const perShare = perShareRisk(plan);
    const shares = perShare > 0 ? Math.floor((acct * risk) / 100 / perShare) : 0;
    const sh = container.querySelector(".ps-shares");
    const dl = container.querySelector(".ps-dollar");
    if (sh) sh.textContent = String(shares);
    if (dl) dl.textContent = (shares * perShare).toFixed(0);
  };
  acctIn.addEventListener("input", recalc);
  riskIn.addEventListener("input", recalc);
}

/**
 * Wire the "Track this trade" button: opens a journal position at the plan's
 * trigger, sized from the sizer inputs. `onTracked` lets the caller refresh
 * its positions panel / status line.
 */
export function wireTrackButton(
  container: HTMLElement,
  symbol: string,
  plan: TradePlan | null,
  onTracked?: () => void,
  context?: Record<string, string | undefined>,
): void {
  const btn = container.querySelector<HTMLButtonElement>(".ps-track");
  if (!btn || !plan) return;
  btn.addEventListener("click", () => {
    const shares = Number(container.querySelector(".ps-shares")?.textContent) || 1;
    // Snapshot the signals firing right now — the edge breakdown learns from it.
    addPosition({ ...openPosition(symbol, plan, shares, Date.now(), plan.entry, plan.side ?? "long"), context });
    btn.disabled = true;
    btn.textContent = "✓ Tracked";
    onTracked?.();
  });
}
