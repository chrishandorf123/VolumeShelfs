/**
 * Trail tab: the quiet trail + signal overlay (src/core/trail.ts) on its own
 * clean chart — no profile, no shelves, just candles, the agreement dots, the
 * EMA gate line, signal tags and the open trade's plan. Reads whatever symbol
 * is loaded on the Explore tab, and replays every past signal honestly.
 * Rendering lives in trail-view.ts, shared with the standalone Trail page.
 */
import { trailRead, type Candle } from "./core";
import { VolumeShelfsChart } from "./chart/chart";
import { formatDate, formatPrice } from "./chart/scale";
import { registerChatContext } from "./chat/context";
import {
  buildTrailModel,
  emptyTrailModel,
  fmtR,
  openTrailSignal,
  trailSignalsPanelHtml,
  trailStatePanelHtml,
  trailStatsPanelHtml,
} from "./trail-view";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

export interface TrailUi {
  activate(): void;
}

export interface TrailSource {
  candles: Candle[];
  source: string;
  interval: string;
}

export function initTrail(getData: () => TrailSource): TrailUi {
  const chart = new VolumeShelfsChart($<HTMLCanvasElement>("trailChart"));
  const meta = $("trailMeta");
  const statusEl = $("trailStatus");
  const statsEl = $("trailStats");
  const signalsEl = $("trailSignals");
  const tfBar = $("tfBarTrail");

  let lastSnapshot = "TRAIL TAB — no data loaded yet.";
  registerChatContext("trail", () => lastSnapshot);

  tfBar.querySelectorAll<HTMLButtonElement>(".tf[data-bars]").forEach((btn) => {
    btn.addEventListener("click", () => {
      tfBar.querySelectorAll(".tf[data-bars]").forEach((b) => b.classList.toggle("active", b === btn));
      const bars = Number(btn.dataset.bars);
      chart.setVisibleCount(bars > 0 ? bars : null);
    });
  });
  const activeTfBars = (): number | null => {
    const btn = tfBar.querySelector<HTMLButtonElement>(".tf[data-bars].active");
    const bars = btn ? Number(btn.dataset.bars) : 126;
    return bars > 0 ? bars : null;
  };

  function render(): void {
    const { candles, source, interval } = getData();
    const read = candles.length >= 40 ? trailRead(candles) : null;

    if (!read) {
      meta.textContent = candles.length
        ? `${source} — need 40+ bars for the trail (have ${candles.length})`
        : "load a symbol on the Explore tab first";
      chart.setModel(emptyTrailModel());
      statusEl.innerHTML = `<div class="panel"><h2>State</h2><div class="empty">${
        candles.length ? "Not enough history for the trail read." : "Nothing loaded — pick a symbol on the Explore tab and it shows up here."
      }</div></div>`;
      statsEl.innerHTML = "";
      signalsEl.innerHTML = "";
      lastSnapshot = "TRAIL TAB — no analyzable data (load a symbol on Explore).";
      return;
    }

    const n = candles.length;
    meta.textContent = `${source} · ${interval} bars · signals replayed over ${n} bars`;
    chart.setModel(buildTrailModel(candles, read));
    statusEl.innerHTML = trailStatePanelHtml(read, candles);
    statsEl.innerHTML = trailStatsPanelHtml(read);
    signalsEl.innerHTML = trailSignalsPanelHtml(read, candles);

    const open = openTrailSignal(read);
    const st = read.stats;
    lastSnapshot = [
      `TRAIL TAB — ${source} (${interval} bars, ${n} loaded), quiet double-SuperTrend trail signals.`,
      `State: ${read.state.toUpperCase()} since ${formatDate(candles[read.stateSince].time)}. ${read.headline}`,
      open
        ? `Open signal: ${open.side.toUpperCase()} @ ${formatPrice(open.entry)}, stop ${formatPrice(open.stop)}, target ${formatPrice(open.target)}, marked ${fmtR(open.outcome.r)}.`
        : "Open signal: none.",
      st
        ? `Replay: ${st.total} signals, ${st.closed} closed (${st.wins}W/${st.losses}L/${st.flips} flips), win rate ${(st.winRate * 100).toFixed(0)}%, expectancy ${fmtR(st.avgR)}, total ${fmtR(st.totalR)}, ${read.skippedFlips} flips skipped by gates. In-sample.`
        : `Replay: no closed trades yet (${read.skippedFlips} flips skipped by gates).`,
    ].join("\n");
  }

  return {
    activate() {
      render(); // Explore may have loaded a different symbol while away
      chart.resize();
      chart.setVisibleCount(activeTfBars());
    },
  };
}
