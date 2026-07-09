/**
 * Shared Trail rendering: the chart model (dots, markers, plan levels) and the
 * sidebar panels, used by both the app's Trail tab (trail-ui.ts) and the
 * standalone Trail page (trail-standalone.ts) so the two can never drift.
 */
import { DEFAULT_TRAIL_CONFIG, type Candle, type TrailRead, type TrailSignal } from "./core";
import type { ChartModel, MarkerOverlay } from "./chart/chart";
import { formatDate, formatPrice } from "./chart/scale";

const UP = "rgba(38, 166, 154, 0.9)";
const DOWN = "rgba(239, 83, 80, 0.9)";
const GRAY = "rgba(139, 149, 167, 0.9)";

export function fmtR(r: number): string {
  return `${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(1)}R`;
}

function signalMarkers(signals: TrailSignal[]): MarkerOverlay[] {
  const markers: MarkerOverlay[] = [];
  for (const s of signals) {
    const long = s.side === "long";
    markers.push({
      index: s.index,
      price: long ? s.entry * 0.995 : s.entry * 1.005,
      text: long ? "▲ LONG" : "▼ SHORT",
      color: long ? UP : DOWN,
      position: long ? "below" : "above",
      emphasis: true,
    });
    const o = s.outcome;
    if (o.status !== "open" && o.exitIndex !== null && o.exitPrice !== null) {
      const win = o.r > 0;
      markers.push({
        index: o.exitIndex,
        price: o.exitPrice,
        text: o.status === "win" ? `✓ ${fmtR(o.r)}` : o.status === "loss" ? `✕ ${fmtR(o.r)}` : `⇄ ${fmtR(o.r)}`,
        color: o.status === "flip" ? GRAY : win ? UP : DOWN,
        // Exit tags sit on the opposite side of the entry tag so they never collide.
        position: long ? "above" : "below",
      });
    }
  }
  return markers;
}

export function openTrailSignal(read: TrailRead): TrailSignal | undefined {
  return read.signals.find((s) => s.outcome.status === "open");
}

/** Clean profile-less chart: candles, EMA, agreement dots, signal tags, and
 *  the open signal's plan levels (history stays tags-only — quiet). */
export function buildTrailModel(candles: Candle[], read: TrailRead): ChartModel {
  const open = openTrailSignal(read);
  return {
    candles,
    profile: null,
    analysis: null,
    anchorIndex: -1,
    currentPrice: candles[candles.length - 1].close,
    show: { profile: false, shelves: false, gaps: false, valueArea: false },
    fullWidthCandles: true,
    overlays: {
      series: [
        { label: `${DEFAULT_TRAIL_CONFIG.emaLength}EMA`, values: read.ema, color: "rgba(91, 141, 239, 0.65)" },
        { label: "trail up", values: read.dotsUp, color: UP, style: "dots", noLabel: true },
        { label: "trail down", values: read.dotsDown, color: DOWN, style: "dots", noLabel: true },
      ],
      levels: open
        ? [
            { label: `Entry ${formatPrice(open.entry)}`, price: open.entry, color: "#5b8def", dashed: true },
            { label: `Stop ${formatPrice(open.stop)}`, price: open.stop, color: "#ef5350", dashed: true },
            { label: `Target ${formatPrice(open.target)} (+${DEFAULT_TRAIL_CONFIG.targetR}R)`, price: open.target, color: "#26a69a", dashed: true },
          ]
        : [],
      markers: signalMarkers(read.signals),
    },
  };
}

export function emptyTrailModel(): ChartModel {
  return {
    candles: [],
    profile: null,
    analysis: null,
    anchorIndex: -1,
    currentPrice: 0,
    show: { profile: false, shelves: false, gaps: false, valueArea: false },
    fullWidthCandles: true,
  };
}

const stat = (k: string, v: string) =>
  `<div class="stat"><span class="k">${k}</span><span class="v">${v}</span></div>`;

export function trailStatePanelHtml(read: TrailRead, candles: Candle[]): string {
  const n = candles.length;
  const open = openTrailSignal(read);
  const sinceDate = formatDate(candles[read.stateSince].time);
  const stateCls = read.state === "up" ? "demand" : read.state === "down" ? "supply" : "neutral";
  const trailNow =
    read.state === "up" ? read.dotsUp[n - 1] : read.state === "down" ? read.dotsDown[n - 1] : NaN;
  return `<div class="panel">
    <h2 data-glossary="trail-signals" title="What is the trail? Click to learn">State</h2>
    <div class="trail-state ${stateCls}">${read.state === "up" ? "▲ BOTH TRAILS UP" : read.state === "down" ? "▼ BOTH TRAILS DOWN" : "◦ MIXED — STAND ASIDE"}</div>
    <p class="muted trail-headline">${read.headline}</p>
    <div class="summary">
      ${stat("Since", sinceDate)}
      ${Number.isFinite(trailNow) ? stat("Trail now", formatPrice(trailNow)) : ""}
      ${
        open
          ? stat("Open signal", `${open.side.toUpperCase()} @ ${formatPrice(open.entry)} (${formatDate(candles[open.index].time)})`) +
            stat("Stop / Target", `${formatPrice(open.stop)} / ${formatPrice(open.target)}`) +
            stat("Marked", fmtR(open.outcome.r))
          : stat("Open signal", "none")
      }
    </div>
  </div>`;
}

export function trailStatsPanelHtml(read: TrailRead): string {
  const st = read.stats;
  return `<div class="panel">
    <h2>Replay on this history</h2>
    ${
      st
        ? `<div class="summary">
            ${stat("Signals", `${st.total} (${st.open} open)`)}
            ${stat("Closed", `${st.closed} — ${st.wins}W / ${st.losses}L / ${st.flips} flips`)}
            ${stat("Win rate", `${(st.winRate * 100).toFixed(0)}%`)}
            ${stat("Expectancy", `${fmtR(st.avgR)} per trade`)}
            ${stat("Total", fmtR(st.totalR))}
            ${stat("Skipped flips", String(read.skippedFlips))}
          </div>
          <p class="muted trail-note">Same-bar stop+target counts as the LOSS. In-sample replay on the loaded bars — a sanity check, not proof of edge.</p>`
        : `<div class="empty">No closed trades on this history yet${read.skippedFlips ? ` (${read.skippedFlips} flip${read.skippedFlips === 1 ? "" : "s"} skipped by the gates)` : ""}.</div>`
    }
  </div>`;
}

export function trailSignalsPanelHtml(read: TrailRead, candles: Candle[]): string {
  const recent = [...read.signals].reverse().slice(0, 8);
  return `<div class="panel">
    <h2>Signals</h2>
    ${
      recent.length
        ? recent
            .map((s) => {
              const o = s.outcome;
              const cls = o.status === "open" ? "neutral" : o.r > 0 ? "demand" : "supply";
              const outcome =
                o.status === "open"
                  ? `open · marked ${fmtR(o.r)}`
                  : `${o.status === "win" ? "target hit" : o.status === "loss" ? "stopped" : "flipped out"} · ${fmtR(o.r)}`;
              return `<div class="sig-row ${cls}">
                <span class="sig-side ${s.side}">${s.side === "long" ? "▲" : "▼"} ${s.side.toUpperCase()}</span>
                <span class="sig-detail">${formatDate(candles[s.index].time)} @ ${formatPrice(s.entry)}</span>
                <span class="sig-outcome">${outcome}</span>
              </div>`;
            })
            .join("")
        : `<div class="empty">No signals on this history — that IS the design when nothing lines up.</div>`
    }
  </div>`;
}
