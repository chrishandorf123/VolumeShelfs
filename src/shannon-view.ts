import type { AvwapMapRow, ShannonRead } from "./core";
import { formatPrice } from "./chart/scale";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

const SLOPE_ARROW: Record<string, string> = {
  rising: "↗",
  flat: "→",
  falling: "↘",
  unknown: "·",
};

function ladderRow(r: AvwapMapRow, nearest: boolean, price: number): string {
  const dist = price > 0 ? ((r.state.value - price) / price) * 100 : NaN;
  const distTxt = Number.isFinite(dist) ? `${dist >= 0 ? "+" : ""}${dist.toFixed(1)}%` : "—";
  return `<div class="lad-row lad-${r.role}${nearest ? " lad-near" : ""}" title="${escapeHtml(r.anchor.why)}">
    <span class="lad-role">${r.role === "supply" ? "SUPPLY" : "SUPPORT"}</span>
    <span class="lad-label">${escapeHtml(r.anchor.label)}</span>
    <span class="lad-val">${formatPrice(r.state.value)} <small>${SLOPE_ARROW[r.state.slope]}</small></span>
    <span class="lad-dist muted">${distTxt}</span>
  </div>`;
}

/**
 * The Shannon panel: market stage, weekly/daily alignment, the AVWAP ladder
 * (every event anchor's AVWAP as supply above / support below price), and the
 * handoff read. One glance answers "who's in control, and from which levels?".
 */
export function shannonPanelHtml(read: ShannonRead, price: number): string {
  const { stage, mtf, map, handoff } = read;

  const stageHtml = stage
    ? `<div class="stage-line stage-${stage.stage}">
        <span class="stage-badge" data-glossary="stage" title="Click to learn">${stage.name}</span>
        <span class="stage-guide">${escapeHtml(stage.guidance)}</span>
      </div>`
    : `<div class="stage-line"><span class="muted">Not enough history for a stage read (needs ~1 year).</span></div>`;

  const dirIcon = (d: "up" | "down" | "neutral") => (d === "up" ? "↑" : d === "down" ? "↓" : "·");
  const mtfHtml = `<div class="mtf-line ${mtf.aligned ? (mtf.weekly === "up" ? "mtf-up" : "mtf-down") : "mtf-mixed"}"
      title="${escapeHtml(mtf.detail)}">
      <span class="mtf-chip">Weekly ${dirIcon(mtf.weekly)}</span>
      <span class="mtf-chip">Daily ${dirIcon(mtf.daily)}</span>
      <span class="mtf-word">${mtf.aligned ? "timeframes aligned" : "timeframes mixed"}</span>
    </div>`;

  // Split the ladder around price and flag the two lines that matter most:
  // the nearest supply overhead and the nearest support underneath.
  const supply = map.filter((r) => r.role === "supply");
  const support = map.filter((r) => r.role === "support");
  const nearestSupply = supply[supply.length - 1];
  const nearestSupport = support[0];
  const ladder =
    map.length === 0
      ? '<div class="empty">No event anchors resolve on this history.</div>'
      : supply.map((r) => ladderRow(r, r === nearestSupply, price)).join("") +
        `<div class="lad-price"><span>price ${formatPrice(price)}</span></div>` +
        support.map((r) => ladderRow(r, r === nearestSupport, price)).join("");

  const handoffHtml = handoff
    ? `<p class="handoff ${handoff.intact ? "ok" : ""}">
        <b data-glossary="handoff" title="Click to learn">${handoff.intact ? "✓ AVWAP handoff intact" : "AVWAP handoff"}</b> — ${escapeHtml(handoff.detail)}</p>`
    : "";

  return `<div class="panel shannon-panel"><h2 data-glossary="avwap-map" title="Click to learn">AVWAP map (Shannon)</h2>
    ${stageHtml}
    ${mtfHtml}
    <div class="ladder">${ladder}</div>
    ${handoffHtml}
  </div>`;
}
