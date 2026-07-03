/**
 * Rotation tab: WHERE the money is going.
 * - RRG map + ranking of the 11 SPDR sector ETFs vs SPY (weekly JdK method,
 *   see core/rotation.ts + docs/RESEARCH.md).
 * - Breadth cross-check from YOUR last scan (price-only rotation reads can be
 *   head-fakes; expanding member breadth confirms them).
 * - An industry browser that groups your scan by sector/industry so "which
 *   groups should I be in?" is answerable at a glance.
 */
import {
  QUADRANT_LABEL,
  resampleWeekly,
  rotationRead,
  type Candle,
  type Quadrant,
  type RotationRead,
  type ScanResult,
  type SectorRotation,
} from "./core";
import { getProvider } from "./data";
import { industryOf, sectorOf } from "./data/sectors";
import { formatPrice } from "./chart/scale";
import { registerChatContext } from "./chat/context";
import type { ScannerUi } from "./scanner-ui";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
const fmtPct = (v: number) =>
  Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%` : "—";

/** The 11 SPDR sector ETFs — the standard rotation universe. */
const SECTOR_ETFS: Array<{ symbol: string; label: string }> = [
  { symbol: "XLK", label: "Technology" },
  { symbol: "XLC", label: "Comm. Services" },
  { symbol: "XLY", label: "Consumer Disc." },
  { symbol: "XLP", label: "Consumer Staples" },
  { symbol: "XLF", label: "Financials" },
  { symbol: "XLV", label: "Health Care" },
  { symbol: "XLI", label: "Industrials" },
  { symbol: "XLE", label: "Energy" },
  { symbol: "XLU", label: "Utilities" },
  { symbol: "XLB", label: "Materials" },
  { symbol: "XLRE", label: "Real Estate" },
];

/** Which scan sector labels (curated + GICS) each ETF's breadth reads from. */
const ETF_SCAN_SECTORS: Record<string, string[]> = {
  XLK: ["Semis", "Software", "Tech hardware", "Information Technology"],
  XLC: ["Comms/media", "Communication Services"],
  XLY: ["Consumer", "Consumer Discretionary"],
  XLP: ["Consumer Staples"],
  XLF: ["Financials", "Crypto-adjacent"],
  XLV: ["Healthcare", "Health Care"],
  XLI: ["Industrials"],
  XLE: ["Energy"],
  XLU: ["Utilities"],
  XLB: ["Materials"],
  XLRE: ["Real estate", "Real Estate"],
};

const QUAD_COLOR: Record<Quadrant, string> = {
  leading: "#26a69a",
  improving: "#5b8def",
  weakening: "#f5c842",
  lagging: "#ef5350",
};

export interface RotationUi {
  activate(): void;
}

export function initRotation(
  setStatus: (msg: string, kind?: "" | "ok" | "error") => void,
  scanner: ScannerUi,
  openTicker: (ticker: string) => void,
): RotationUi {
  const els = {
    run: $<HTMLButtonElement>("rotRun"),
    demo: $<HTMLButtonElement>("rotDemo"),
    meta: $("rotMeta"),
    digest: $("rotDigest"),
    chart: $("rotChart"),
    table: $("rotTable"),
    indSearch: $<HTMLInputElement>("indSearch"),
    indBody: $("industryBody"),
    indMeta: $("indMeta"),
  };

  let lastRead: RotationRead | null = null;
  let lastLabel = "";

  // ---- data -----------------------------------------------------------------
  async function runLive(): Promise<void> {
    const da = scanner.dataAccess();
    const provider = getProvider(da.providerId);
    if (!provider) return;
    if (provider.requiresApiKey && !da.apiKey) {
      setStatus("Rotation needs your data key — set it on the Scanner tab (Ticker list → API), then run again.", "error");
      return;
    }
    els.run.disabled = true;
    try {
      const weeklyOf = async (symbol: string): Promise<Candle[]> => {
        await da.pace();
        els.meta.textContent = `fetching ${symbol}…`;
        const daily = await provider.fetchCandles({ symbol, interval: "daily" }, da.apiKey || undefined);
        return resampleWeekly(daily);
      };
      const bench = await weeklyOf("SPY");
      const sectors: Array<{ symbol: string; label: string; weekly: Candle[] }> = [];
      const failures: string[] = [];
      for (const s of SECTOR_ETFS) {
        try {
          sectors.push({ ...s, weekly: await weeklyOf(s.symbol) });
        } catch {
          failures.push(s.symbol);
        }
      }
      if (!sectors.length) throw new Error("No sector data returned — check the key / rate limit.");
      lastRead = rotationRead(sectors, bench);
      lastLabel = `live · ${new Date().toLocaleDateString()}${failures.length ? ` · skipped ${failures.join(", ")}` : ""}`;
      render();
      setStatus(`Rotation read complete — ${lastRead.sectors.length}/11 sectors mapped.`, "ok");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err), "error");
    } finally {
      els.run.disabled = false;
      els.meta.textContent = lastLabel;
    }
  }

  /** Deterministic synthetic sectors so the tab teaches itself without a key. */
  function runDemo(): void {
    const W = 130;
    const mkWeekly = (rate: (week: number) => number): Candle[] => {
      const out: Candle[] = [];
      let p = 100;
      for (let i = 0; i < W; i++) {
        p *= rate(i);
        out.push({ time: 1_600_000_000 + i * 7 * 86400, open: p, high: p * 1.01, low: p * 0.99, close: p, volume: 1e6 });
      }
      return out;
    };
    const bench = mkWeekly(() => 1.003);
    const profiles: Record<string, (k: number) => number> = {
      XLK: (k) => (k < 90 ? 1.003 : 1.008), // accelerating leader
      XLC: (k) => (k < 100 ? 1.0045 : 1.006),
      XLY: (k) => (k < 105 ? 1.004 : 1.0),  // long leader, momentum cracking
      XLF: (k) => (k < 100 ? 1.006 : 1.001), // weakening
      XLE: (k) => (k < 118 ? 0.999 : 1.008), // just turned — improving
      XLB: (k) => (k < 112 ? 0.999 : 1.005), // improving
      XLP: () => 1.0, // defensive laggard
      XLU: () => 0.9995,
      XLRE: () => 0.998,
      XLV: () => 1.002,
      XLI: () => 1.003, // pacing the market
    };
    const sectors = SECTOR_ETFS.map((s) => ({ ...s, weekly: mkWeekly(profiles[s.symbol]) }));
    lastRead = rotationRead(sectors, bench);
    lastLabel = "demo data — synthetic sectors to show how the map reads";
    render();
    setStatus("Demo rotation loaded — Run rotation read uses your real data key.", "ok");
  }

  // ---- rendering --------------------------------------------------------------
  function render(): void {
    els.meta.textContent = lastLabel;
    renderDigest();
    renderChart();
    renderTable();
    renderIndustries();
  }

  function renderDigest(): void {
    if (!lastRead) {
      els.digest.hidden = true;
      return;
    }
    els.digest.hidden = false;
    els.digest.innerHTML = lastRead.digest.map((d) => `<div class="rot-dg-line">${esc(d)}</div>`).join("") +
      (lastRead.thin ? `<div class="rot-dg-line muted">Some sectors lacked history and were skipped.</div>` : "");
  }

  function renderChart(): void {
    if (!lastRead || !lastRead.sectors.length) {
      els.chart.innerHTML = `<div class="empty">Run the rotation read (or Demo) to draw the map.</div>`;
      return;
    }
    const S = 560; // square drawing area
    const pad = 34;
    // Symmetric extent about 100 so the quadrant cross sits in the center.
    let dev = 3;
    for (const s of lastRead.sectors) {
      for (const p of s.trail) {
        dev = Math.max(dev, Math.abs(p.ratio - 100), Math.abs(p.momentum - 100));
      }
    }
    dev *= 1.18;
    const x = (v: number) => pad + ((v - (100 - dev)) / (2 * dev)) * (S - 2 * pad);
    const y = (v: number) => S - pad - ((v - (100 - dev)) / (2 * dev)) * (S - 2 * pad);
    const mid = x(100);
    const midY = y(100);
    const quadRect = (x0: number, y0: number, w: number, h: number, color: string) =>
      `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="${color}" opacity="0.07"/>`;
    let svg = `<svg viewBox="0 0 ${S} ${S}" class="rot-svg" role="img" aria-label="Relative rotation map">`;
    svg += quadRect(mid, pad, S - pad - mid, midY - pad, QUAD_COLOR.leading); // top-right
    svg += quadRect(pad, pad, mid - pad, midY - pad, QUAD_COLOR.improving); // top-left
    svg += quadRect(mid, midY, S - pad - mid, S - pad - midY, QUAD_COLOR.weakening); // bottom-right
    svg += quadRect(pad, midY, mid - pad, S - pad - midY, QUAD_COLOR.lagging); // bottom-left
    svg += `<line x1="${mid}" y1="${pad}" x2="${mid}" y2="${S - pad}" class="rot-axis"/>`;
    svg += `<line x1="${pad}" y1="${midY}" x2="${S - pad}" y2="${midY}" class="rot-axis"/>`;
    svg += `<text x="${S - pad - 4}" y="${pad + 14}" class="rot-quad-label" text-anchor="end" fill="${QUAD_COLOR.leading}">LEADING</text>`;
    svg += `<text x="${pad + 4}" y="${pad + 14}" class="rot-quad-label" fill="${QUAD_COLOR.improving}">IMPROVING</text>`;
    svg += `<text x="${S - pad - 4}" y="${S - pad - 6}" class="rot-quad-label" text-anchor="end" fill="${QUAD_COLOR.weakening}">WEAKENING</text>`;
    svg += `<text x="${pad + 4}" y="${S - pad - 6}" class="rot-quad-label" fill="${QUAD_COLOR.lagging}">LAGGING</text>`;
    svg += `<text x="${S / 2}" y="${S - 6}" class="rot-axis-label" text-anchor="middle">JdK RS-Ratio → (trend of relative strength)</text>`;
    svg += `<text x="10" y="${S / 2}" class="rot-axis-label" text-anchor="middle" transform="rotate(-90 10 ${S / 2})">JdK RS-Momentum ↑</text>`;
    for (const s of lastRead.sectors) {
      const color = QUAD_COLOR[s.quadrant];
      const pts = s.trail.map((p) => `${x(p.ratio).toFixed(1)},${y(p.momentum).toFixed(1)}`).join(" ");
      svg += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" opacity="0.55"/>`;
      // small dots along the trail, big labeled dot at "now"
      s.trail.slice(0, -1).forEach((p, i) => {
        svg += `<circle cx="${x(p.ratio).toFixed(1)}" cy="${y(p.momentum).toFixed(1)}" r="${1.5 + i * 0.3}" fill="${color}" opacity="0.45"/>`;
      });
      const nx = x(s.point.ratio);
      const ny = y(s.point.momentum);
      svg += `<circle cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="6" fill="${color}"/>`;
      svg += `<text x="${(nx + 9).toFixed(1)}" y="${(ny + 4).toFixed(1)}" class="rot-tk" fill="${color}">${s.symbol}</text>`;
    }
    svg += `</svg>`;
    els.chart.innerHTML = svg;
  }

  /** Breadth stats for an ETF from the last scan (empty when no scan yet). */
  function breadthOf(symbol: string): string {
    const results = scanner.results();
    if (!results.length) return `<span class="muted">—</span>`;
    const groups = ETF_SCAN_SECTORS[symbol] ?? [];
    const members = results.filter((r) => groups.includes(sectorOf(r.ticker)));
    if (!members.length) return `<span class="muted">no members scanned</span>`;
    const above = members.filter((r) => r.aboveMa200).length;
    const aplus = members.filter((r) => r.passedAll).length;
    const pct = Math.round((above / members.length) * 100);
    return `${members.length} scanned · <b class="${pct >= 60 ? "pos" : pct <= 40 ? "neg" : ""}">${pct}%</b> >200d${aplus ? ` · <b class="pos">${aplus} A+</b>` : ""}`;
  }

  function renderTable(): void {
    if (!lastRead || !lastRead.sectors.length) {
      els.table.innerHTML = `<div class="empty">No read yet.</div>`;
      return;
    }
    const arrow = (deg: number) => {
      if (!Number.isFinite(deg)) return "·";
      const dirs = ["→", "↗", "↑", "↖", "←", "↙", "↓", "↘"];
      return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
    };
    const rows = lastRead.sectors
      .map((s: SectorRotation) => {
        const chip = `<span class="rot-chip" style="color:${QUAD_COLOR[s.quadrant]};border-color:${QUAD_COLOR[s.quadrant]}">${QUADRANT_LABEL[s.quadrant]}</span>`;
        const freshTag = s.weeksInQuadrant <= 2 && s.cameFrom !== s.quadrant ? ` <span class="rot-fresh" title="Crossed into this quadrant within the last 2 weeks — rotation in motion">NEW</span>` : "";
        return `<tr data-etf="${s.symbol}" title="Click to browse this sector's stocks from your scan (below)">
          <td class="tk">${s.symbol} <span class="muted">${esc(s.label)}</span></td>
          <td>${chip}${freshTag}</td>
          <td>${s.point.ratio.toFixed(1)}</td>
          <td>${s.point.momentum.toFixed(1)} <span class="rot-arrow">${arrow(s.headingDeg)}</span></td>
          <td class="muted">${s.weeksInQuadrant}w</td>
          <td class="${s.rel1m >= 0 ? "pos" : "neg"}">${fmtPct(s.rel1m)}</td>
          <td class="${s.rel3m >= 0 ? "pos" : "neg"}">${fmtPct(s.rel3m)}</td>
          <td class="rot-breadth">${breadthOf(s.symbol)}</td>
        </tr>`;
      })
      .join("");
    els.table.innerHTML = `<table class="mon-table rot-ranks"><thead><tr>
      <th>Sector</th><th title="RRG quadrant — sectors travel clockwise">Quadrant</th>
      <th title="JdK RS-Ratio: >100 = relative uptrend vs SPY">Ratio</th>
      <th title="JdK RS-Momentum: >100 = the relative trend is accelerating. Arrow = heading on the map">Mom</th>
      <th title="Weeks in the current quadrant">In quad</th>
      <th title="Return vs SPY, last 4 weeks">1m vs SPY</th><th title="Return vs SPY, last 13 weeks">3m vs SPY</th>
      <th title="Breadth from YOUR scan: members above their 200-day + A+ setups. Confirms (or contradicts) the price-only read">Scan breadth</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
    els.table.querySelectorAll<HTMLTableRowElement>("tr[data-etf]").forEach((tr) => {
      tr.addEventListener("click", () => {
        const groups = ETF_SCAN_SECTORS[tr.dataset.etf!] ?? [];
        els.indSearch.value = groups[0] ?? "";
        renderIndustries();
        els.indBody.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  // ---- industry browser -------------------------------------------------------
  function renderIndustries(): void {
    const results = scanner.results();
    if (!results.length) {
      els.indMeta.textContent = "";
      els.indBody.innerHTML = `<div class="empty">Run a scan on the Scanner tab first — this groups YOUR scan by sector/industry so you can see which groups to be in.</div>`;
      return;
    }
    const q = els.indSearch.value.trim().toLowerCase();
    interface Group {
      name: string;
      members: ScanResult[];
    }
    const byName = new Map<string, Group>();
    for (const r of results) {
      const name = sectorOf(r.ticker);
      if (!byName.has(name)) byName.set(name, { name, members: [] });
      byName.get(name)!.members.push(r);
    }
    let groups = [...byName.values()];
    if (q) {
      groups = groups
        .map((g) => ({
          ...g,
          members: g.members.filter(
            (r) =>
              g.name.toLowerCase().includes(q) ||
              r.ticker.toLowerCase().includes(q) ||
              industryOf(r.ticker).toLowerCase().includes(q),
          ),
        }))
        .filter((g) => g.members.length);
    }
    // Strongest groups first: average 3-month RS (the leadership yardstick).
    const avgRs = (g: Group) => g.members.reduce((a, r) => a + (Number.isFinite(r.rs.excess3mo) ? r.rs.excess3mo : 0), 0) / g.members.length;
    groups.sort((a, b) => avgRs(b) - avgRs(a));
    els.indMeta.textContent = `${groups.length} group${groups.length === 1 ? "" : "s"} · strongest first (avg 3-mo RS)`;
    els.indBody.innerHTML = groups
      .map((g, gi) => {
        const above = g.members.filter((r) => r.aboveMa200).length;
        const aplus = g.members.filter((r) => r.passedAll).length;
        const rs = avgRs(g);
        const pct = Math.round((above / g.members.length) * 100);
        const members = [...g.members]
          .sort((a, b) => b.score - a.score)
          .map((r) => {
            const verdict = r.gatesPassed >= 6 ? "pos" : r.gatesPassed <= 3 ? "neg" : "";
            return `<button class="ind-member" data-ticker="${r.ticker}" type="button" title="${esc(industryOf(r.ticker))} — open in Scanner">
              <b>${r.ticker}</b> <span class="muted">${formatPrice(r.price)}</span>
              <span class="${r.rs.excess3mo >= 0 ? "pos" : "neg"}">${fmtPct(r.rs.excess3mo)}</span>
              <span class="${verdict}">${r.gatesPassed}/7</span>
              ${r.passedAll ? '<span class="apex-badge">A+</span>' : ""}
              <span class="ind-ind muted">${esc(industryOf(r.ticker))}</span>
            </button>`;
          })
          .join("");
        return `<details class="ind-group" ${gi < 3 || q ? "open" : ""}>
          <summary><span class="ind-rank">#${gi + 1}</span> <b>${esc(g.name)}</b>
            <span class="muted">${g.members.length} name${g.members.length === 1 ? "" : "s"}</span>
            <span class="${rs >= 0 ? "pos" : "neg"}">avg RS ${fmtPct(rs)}</span>
            <span class="${pct >= 60 ? "pos" : pct <= 40 ? "neg" : "muted"}">${pct}% >200d</span>
            ${aplus ? `<span class="apex-badge">${aplus} A+</span>` : ""}
          </summary>
          <div class="ind-members">${members}</div>
        </details>`;
      })
      .join("");
    els.indBody.querySelectorAll<HTMLButtonElement>(".ind-member").forEach((b) => {
      b.addEventListener("click", () => openTicker(b.dataset.ticker!));
    });
  }

  // ---- chat context ------------------------------------------------------------
  registerChatContext("rotation", () => {
    if (!lastRead) return "ROTATION TAB — no rotation read run yet this session.";
    const lines = [`ROTATION TAB (${lastLabel}):`, ...lastRead.digest];
    for (const s of lastRead.sectors) {
      lines.push(
        `- ${s.symbol} ${s.label}: ${QUADRANT_LABEL[s.quadrant]} (ratio ${s.point.ratio.toFixed(1)}, momentum ${s.point.momentum.toFixed(1)}, ${s.weeksInQuadrant}w in quadrant, 1m vs SPY ${fmtPct(s.rel1m)}, 3m ${fmtPct(s.rel3m)})`,
      );
    }
    return lines.join("\n");
  });

  // ---- wiring -------------------------------------------------------------------
  els.run.addEventListener("click", () => void runLive());
  els.demo.addEventListener("click", runDemo);
  els.indSearch.addEventListener("input", renderIndustries);

  return {
    activate() {
      // The scan may have changed while we were away — refresh the browser and
      // the breadth column, keep the last rotation map.
      renderIndustries();
      if (lastRead) renderTable();
    },
  };
}
