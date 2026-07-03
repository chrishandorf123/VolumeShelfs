import type { AnomalyReport, InstitutionalRead } from "./core";

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** Compact A–E pill for the results table. */
export function instPillHtml(read: InstitutionalRead | null): string {
  if (!read) return "<span class='muted'>—</span>";
  return `<span class="inst-pill inst-${read.rating}" title="${esc(read.headline)}">${read.rating}<small>${read.score}</small></span>`;
}

/** Small warning/opportunity icon for the ticker cell. */
export function tapeIconHtml(rep: AnomalyReport | null): string {
  if (!rep) return "";
  if (rep.character === "predatory" || rep.level === "SKETCHY")
    return ` <span class="tape-icon bad" title="${esc(rep.headline)}">⚠</span>`;
  if (rep.character === "games-accumulation")
    return ` <span class="tape-icon games" title="${esc(rep.headline)}">🎭</span>`;
  if (rep.character === "games-distribution")
    return ` <span class="tape-icon dist" title="${esc(rep.headline)}">🎭</span>`;
  return "";
}

/** Who's in the name: the institutional accumulation/distribution read. */
export function institutionalPanelHtml(read: InstitutionalRead | null): string {
  if (!read)
    return `<div class="panel"><h2 data-glossary="institutional" title="Click to learn">🏦 Institutional footprint</h2>
      <div class="empty">Needs ~60 bars of history — no accumulation/distribution read on this name yet.</div></div>`;
  const rows = read.evidence
    .map(
      (e) => `<div class="gate-row ${e.vote > 0 ? "pass" : e.vote < 0 ? "fail" : "warn"}">
        <span class="dot"></span><span class="gl">${esc(e.label)}</span>
        <span class="gd muted">${esc(e.detail)}</span></div>`,
    )
    .join("");
  return `<div class="panel"><h2 data-glossary="institutional" title="Click to learn">🏦 Institutional footprint ${instPillHtml(read)}</h2>
    <p class="early-head">${esc(read.headline)}</p>${rows}</div>`;
}

/** The manipulation read — with its character spelled out. */
export function anomalyPanelHtml(rep: AnomalyReport | null): string {
  if (!rep)
    return `<div class="panel"><h2 data-glossary="manipulation" title="Click to learn">🎛 Tape check <span class="tape-chip warn">UNSCREENED</span></h2>
      <div class="empty">Needs ~80 bars of history — this tape is UNSCREENED for manipulation patterns. The discipline guard sizes down accordingly.</div></div>`;
  const chr =
    rep.character === "predatory"
      ? '<span class="tape-chip bad">☠ PREDATORY</span>'
      : rep.character === "games-accumulation"
        ? '<span class="tape-chip games">🎭 GAMES · BUYER</span>'
        : rep.character === "games-distribution"
          ? '<span class="tape-chip dist">🎭 GAMES · SELLER</span>'
          : rep.level === "WATCH"
            ? '<span class="tape-chip warn">ODDITIES</span>'
            : '<span class="tape-chip ok">CLEAN</span>';
  const riskRows = rep.flags
    .filter((f) => f.hit)
    .map(
      (f) => `<div class="gate-row fail"><span class="dot"></span><span class="gl">${esc(f.label)}</span>
        <span class="gd muted">${esc(f.detail)}</span></div>`,
    )
    .join("");
  const gameRows = rep.games
    .filter((g) => g.hit)
    .map(
      (g) => `<div class="gate-row pass"><span class="dot"></span><span class="gl">${esc(g.label)}</span>
        <span class="gd muted">${esc(g.detail)}</span></div>`,
    )
    .join("");
  const clean = !riskRows && !gameRows ? '<div class="empty">No manipulation-pattern flags on this tape.</div>' : "";
  return `<div class="panel"><h2 data-glossary="manipulation" title="Click to learn">🎛 Tape check ${chr}</h2>
    <p class="early-head">${esc(rep.headline)}</p>${gameRows}${riskRows}${clean}</div>`;
}
