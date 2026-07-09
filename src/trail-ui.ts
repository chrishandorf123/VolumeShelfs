/**
 * Trail tab: the quiet trail + signal overlay (src/core/trail.ts) on its own
 * clean chart — no profile, no shelves, just candles, the agreement dots, the
 * EMA gate line, signal tags and the open trade's plan. Reads whatever symbol
 * is loaded on the Explore tab, and replays every past signal honestly.
 */
import { trailRead, DEFAULT_TRAIL_CONFIG, type Candle, type TrailSignal } from "./core";
import { VolumeShelfsChart, type ChartModel, type MarkerOverlay } from "./chart/chart";
import { formatDate, formatPrice } from "./chart/scale";
import { registerChatContext } from "./chat/context";

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

const UP = "rgba(38, 166, 154, 0.9)";
const DOWN = "rgba(239, 83, 80, 0.9)";
const GRAY = "rgba(139, 149, 167, 0.9)";

function fmtR(r: number): string {
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

  const stat = (k: string, v: string) =>
    `<div class="stat"><span class="k">${k}</span><span class="v">${v}</span></div>`;

  function render(): void {
    const { candles, source, interval } = getData();
    const read = candles.length >= 40 ? trailRead(candles) : null;

    if (!read) {
      meta.textContent = candles.length
        ? `${source} — need 40+ bars for the trail (have ${candles.length})`
        : "load a symbol on the Explore tab first";
      chart.setModel({
        candles: [],
        profile: null,
        analysis: null,
        anchorIndex: -1,
        currentPrice: 0,
        show: { profile: false, shelves: false, gaps: false, valueArea: false },
      });
      statusEl.innerHTML = `<div class="panel"><h2>State</h2><div class="empty">${
        candles.length ? "Not enough history for the trail read." : "Nothing loaded — pick a symbol on the Explore tab and it shows up here."
      }</div></div>`;
      statsEl.innerHTML = "";
      signalsEl.innerHTML = "";
      lastSnapshot = "TRAIL TAB — no analyzable data (load a symbol on Explore).";
      return;
    }

    const n = candles.length;
    const price = candles[n - 1].close;
    meta.textContent = `${source} · ${interval} bars · signals replayed over ${n} bars`;

    // Open signal (if any) drives the level lines — history stays tags-only.
    const open = read.signals.find((s) => s.outcome.status === "open");
    const model: ChartModel = {
      candles,
      profile: null,
      analysis: null,
      anchorIndex: -1,
      currentPrice: price,
      show: { profile: false, shelves: false, gaps: false, valueArea: false },
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
    chart.setModel(model);

    // ---- State panel ----
    const sinceDate = formatDate(candles[read.stateSince].time);
    const stateCls = read.state === "up" ? "demand" : read.state === "down" ? "supply" : "neutral";
    const trailNow =
      read.state === "up" ? read.dotsUp[n - 1] : read.state === "down" ? read.dotsDown[n - 1] : NaN;
    statusEl.innerHTML = `<div class="panel">
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

    // ---- Stats panel ----
    const st = read.stats;
    statsEl.innerHTML = `<div class="panel">
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

    // ---- Signals list (newest first, capped — quiet, remember) ----
    const recent = [...read.signals].reverse().slice(0, 8);
    signalsEl.innerHTML = `<div class="panel">
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

    lastSnapshot = [
      `TRAIL TAB — ${source} (${interval} bars, ${n} loaded), quiet double-SuperTrend trail signals.`,
      `State: ${read.state.toUpperCase()} since ${sinceDate}. ${read.headline}`,
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
