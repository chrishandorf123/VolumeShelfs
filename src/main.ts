import "./styles.css";
import {
  DEFAULT_OPTIONS,
  DEFAULT_SCAN_CONFIG,
  analyzeProfile,
  anchorCoach,
  anchoredVwapBands,
  anchoredVwapSeries,
  buildAvwapMap,
  buildShortPlan,
  buildThesis,
  buildTradePlan,
  checkDiscipline,
  finalCall,
  computeAnchoredProfile,
  defaultAnchorIndex,
  detectSwings,
  DEFAULT_BACKTEST_CONFIG,
  buildTables,
  anomalyScan,
  decide,
  analyzeRetracement,
  earlySignal,
  institutionalRead,
  nextSteps,
  proveEarlySignal,
  resampleWeekly,
  recommend,
  recoContextFromScan,
  runBacktest,
  heisenbergRead,
  scanTicker,
  shannonRead,
  smaSeries,
  type AnalysisOptions,
  type AnchorCoach,
  type Candle,
  type ChosenAnchor,
  type HeisenbergRead,
  type MarketRegime,
  type ScanResult,
  type SignalProof,
} from "./core";
import { VolumeShelfsChart, type ChartModel, type ChartOverlays } from "./chart/chart";
import { PROVIDERS, getProvider, parseCsv, type Interval } from "./data";
import { formatPrice, formatVolume } from "./chart/scale";
import { initScanner } from "./scanner-ui";
import { initRotation } from "./rotation-ui";
import { initPlaybooks } from "./playbooks-ui";
import { initGuide } from "./guide";
import { coachPanelHtml } from "./coach-view";
import { recoPanelHtml } from "./reco-view";
import { shannonPanelHtml } from "./shannon-view";
import { disciplinePanelHtml, finalCallPanelHtml } from "./decision-view";
import { earlyPanelHtml, proofPanelHtml } from "./early-view";
import { retracementPanelHtml } from "./retracement-view";
import { anomalyPanelHtml, institutionalPanelHtml } from "./tape-view";
import { celebrate } from "./celebrate";
import { loadPositions } from "./journal-store";
import { sectorOf } from "./data/sectors";
import { confirmationPanelHtml, confluencePanelHtml, thesisPanelHtml } from "./thesis-view";
import { tradePlanPanelHtml, wirePositionSizer, wireTrackButton } from "./trade-view";
import { heisenbergPanelHtml } from "./heisenberg-view";
import { modelPanelHtml } from "./model-view";
import { initChat } from "./chat-ui";
import { registerChatContext } from "./chat/context";

// ---- DOM helpers -----------------------------------------------------------
const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const els = {
  status: $("status"),
  provider: $<HTMLSelectElement>("provider"),
  apiKeyField: $("apiKeyField"),
  apiKey: $<HTMLInputElement>("apiKey"),
  symbol: $<HTMLInputElement>("symbol"),
  interval: $<HTMLSelectElement>("interval"),
  load: $<HTMLButtonElement>("load"),
  csvBtn: $<HTMLButtonElement>("csvBtn"),
  csvInput: $<HTMLInputElement>("csvInput"),
  anchorMode: $<HTMLSelectElement>("anchorMode"),
  profileRange: $<HTMLSelectElement>("profileRange"),
  rows: $<HTMLInputElement>("rows"),
  rowsVal: $("rowsVal"),
  scale: $<HTMLSelectElement>("scale"),
  va: $<HTMLInputElement>("va"),
  vaVal: $("vaVal"),
  tShelves: $<HTMLInputElement>("tShelves"),
  tGaps: $<HTMLInputElement>("tGaps"),
  tProfile: $<HTMLInputElement>("tProfile"),
  tVa: $<HTMLInputElement>("tVa"),
  summary: $("summary"),
  zones: $("zones"),
  gaps: $("gaps"),
  tfBar: $("tfBarExplore"),
  exploreReco: $("exploreReco"),
  anchorCoach: $("anchorCoach"),
  modelPanel: $("modelPanel"),
};

// ---- persisted settings ----------------------------------------------------
const LS = {
  provider: "vs.provider",
  symbol: "vs.symbol",
  interval: "vs.interval",
  opts: "vs.opts",
  key: (id: string) => `vs.key.${id}`,
};

type AnchorMode = "auto-low" | "auto-high" | "manual";

interface State {
  candles: Candle[];
  anchorIndex: number;
  anchorMode: AnchorMode;
  options: AnalysisOptions;
  source: string;
  /** "anchored" = volume from the anchor forward (the trade read).
   *  "full" = the whole loaded history — shows shelves at old highs/lows. */
  profileRange: "anchored" | "full";
}

const state: State = {
  candles: [],
  anchorIndex: 0,
  anchorMode: "auto-low",
  options: { ...DEFAULT_OPTIONS },
  source: "",
  profileRange: "anchored",
};

// ---- chart -----------------------------------------------------------------
const chart = new VolumeShelfsChart($<HTMLCanvasElement>("chart"));
chart.onAnchorChange = (index) => {
  els.anchorMode.value = "manual";
  state.anchorMode = "manual";
  state.anchorIndex = index;
  recompute();
};

// ---- status ----------------------------------------------------------------
function setStatus(msg: string, kind: "" | "ok" | "error" = ""): void {
  els.status.textContent = msg;
  els.status.className = `topbar-status ${kind}`;
}

// ---- provider UI -----------------------------------------------------------
function initProviders(): void {
  for (const p of PROVIDERS) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.label;
    els.provider.appendChild(opt);
  }
  els.provider.value = localStorage.getItem(LS.provider) ?? PROVIDERS[0].id;
  syncProviderUi();
  els.provider.addEventListener("change", () => {
    localStorage.setItem(LS.provider, els.provider.value);
    syncProviderUi();
  });
}

function syncProviderUi(): void {
  const provider = getProvider(els.provider.value);
  if (!provider) return;
  els.apiKeyField.hidden = !provider.requiresApiKey;
  els.apiKey.value = localStorage.getItem(LS.key(provider.id)) ?? "";
  els.symbol.placeholder = provider.id === "sample" ? "DEMO-SHELF" : "AAPL";
  // Show/refresh provider note.
  let note = document.getElementById("providerNote");
  if (provider.note) {
    if (!note) {
      note = document.createElement("div");
      note.id = "providerNote";
      note.className = "provider-note";
      els.provider.parentElement!.appendChild(note);
    }
    note.textContent = provider.note + (provider.keyUrl ? "" : "");
  } else if (note) {
    note.remove();
  }
}

// ---- anchor selection ------------------------------------------------------
function pickAnchor(coach: AnchorCoach | null): number {
  const c = state.candles;
  if (c.length === 0) return 0;
  if (state.anchorMode === "manual") {
    return Math.min(Math.max(state.anchorIndex, 0), c.length - 1);
  }
  // In auto mode, use the coach's pivot — it's already searched within the
  // selected timeframe window, so the anchor tracks the timeframe you picked.
  if (coach) {
    return state.anchorMode === "auto-high" ? coach.high.index : coach.low.index;
  }
  // Fallback (coach unavailable, e.g. too little history): whole-series pivot.
  if (state.anchorMode === "auto-high") {
    const minBars = 20;
    const lastAllowed = Math.max(0, c.length - minBars);
    const highs = detectSwings(c, 5).filter((s) => s.kind === "high" && s.index <= lastAllowed);
    if (!highs.length) return Math.floor(c.length * 0.4);
    return highs.reduce((best, s) => (s.price > best.price ? s : best), highs[0]).index;
  }
  return defaultAnchorIndex(c, 5, 20);
}

// ---- core recompute --------------------------------------------------------
function recompute(): void {
  const c = state.candles;
  if (c.length === 0) {
    chart.setModel(emptyModel());
    renderSidebar(null);
    return;
  }
  // Search the coach's pivots within the on-screen timeframe, then anchor from
  // one of them in auto mode — so "swing high / swing low" tracks the timeframe.
  const coach = anchorCoach(c, activeTfBars() ?? c.length);
  if (state.anchorMode !== "manual") state.anchorIndex = pickAnchor(coach);
  const anchor = Math.min(Math.max(state.anchorIndex, 0), c.length - 1);
  const currentPrice = c[c.length - 1].close;

  // Full-history mode anchors the PROFILE at bar 0 so shelves at old highs and
  // lows (where price traded years ago) stay on the map — "what's coming" if
  // price travels. The trade logic (scan/AVWAP/plan) stays on the chosen anchor.
  const fullRange = state.profileRange === "full";
  // Full mode spans a much larger price range — auto-scale the row count so
  // each row keeps roughly the anchored view's price resolution (capped at 240).
  let rowCount = state.options.rowCount;
  if (fullRange && c.length > 1) {
    const span = (from: number) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = from; i < c.length; i++) {
        if (c[i].low < lo) lo = c[i].low;
        if (c[i].high > hi) hi = c[i].high;
      }
      return lo > 0 ? hi / lo : 1;
    };
    const ratio = Math.log(Math.max(1.01, span(0))) / Math.log(Math.max(1.01, span(anchor)));
    if (Number.isFinite(ratio) && ratio > 1) rowCount = Math.min(240, Math.round(rowCount * ratio));
  }
  const profile = computeAnchoredProfile(c, fullRange ? 0 : anchor, {
    rowCount,
    scale: state.options.scale,
    valueAreaFraction: state.options.valueAreaFraction,
  });
  const analysis = analyzeProfile(profile, currentPrice, {
    shelfThreshold: state.options.shelfThreshold,
    gapThreshold: state.options.gapThreshold,
  });

  renderAnchorCoach(coach, anchor);

  // Run the scan once, on the SAME anchor as the chart, and drive both the
  // verdict/thesis panels and the chart overlays (AVWAP, bands, MAs, levels)
  // from it — so nothing on screen can contradict anything else.
  const anchoredFromHigh =
    state.anchorMode === "auto-high"
      ? true
      : state.anchorMode === "auto-low"
        ? false
        : isHighAnchorBar(c, anchor);
  const scan = runExploreScan(c, anchor, anchoredFromHigh);

  const model: ChartModel = {
    candles: c,
    profile,
    analysis,
    anchorIndex: anchor,
    currentPrice,
    show: {
      profile: els.tProfile.checked,
      shelves: els.tShelves.checked,
      gaps: els.tGaps.checked,
      valueArea: els.tVa.checked,
    },
    suggestions: coach
      ? [
          { index: coach.low.index, price: coach.low.price, kind: "low", recommended: coach.low.recommended },
          { index: coach.high.index, price: coach.high.price, kind: "high", recommended: coach.high.recommended },
        ]
      : undefined,
    overlays: scan ? buildExploreOverlays(c, anchor, scan) : undefined,
    fitProfileRange: fullRange,
  };
  chart.setModel(model);
  renderSidebar(model);
  renderExploreReco(scan);
}

/** Render the interactive Anchor Coach: which pivot to anchor from, and why. */
function renderAnchorCoach(coach: AnchorCoach | null, anchorIndex: number): void {
  if (!coach) {
    els.anchorCoach.innerHTML = "";
    return;
  }
  const btn = (s: AnchorCoach["low"]) => {
    const active = state.anchorMode === "manual" && anchorIndex === s.index;
    return `<button class="coach-btn ${s.kind} ${s.recommended ? "rec" : ""} ${active ? "active" : ""}" data-anchor-idx="${s.index}">
      <span class="cb-flag">⚑</span> Swing ${s.kind} · ${formatPrice(s.price)}${s.recommended ? ' <span class="rec-tag">best</span>' : ""}</button>`;
  };
  els.anchorCoach.innerHTML = `<div class="panel coach">
    <h2 data-glossary="anchor" title="What is an anchor? Click to learn">Anchor coach</h2>
    <p class="coach-why">${escapeHtml(coach.rationale)}</p>
    <div class="coach-btns">${btn(coach.low)}${btn(coach.high)}</div>
  </div>`;
  els.anchorCoach.querySelectorAll<HTMLButtonElement>(".coach-btn").forEach((b) => {
    b.addEventListener("click", () => {
      state.anchorMode = "manual";
      els.anchorMode.value = "manual";
      state.anchorIndex = Number(b.dataset.anchorIdx);
      recompute();
    });
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function emptyModel(): ChartModel {
  return {
    candles: [],
    profile: null,
    analysis: null,
    anchorIndex: 0,
    currentPrice: 0,
    show: { profile: true, shelves: true, gaps: true, valueArea: false },
  };
}

// ---- sidebar rendering -----------------------------------------------------
function renderSidebar(model: ChartModel | null): void {
  if (!model || !model.profile || !model.analysis) {
    els.summary.innerHTML = `<div class="empty">No data loaded.</div>`;
    els.zones.innerHTML = "";
    els.gaps.innerHTML = "";
    return;
  }
  const { profile, analysis, currentPrice, candles } = model;
  // These stats describe the PROFILE, so date them from the profile's own
  // anchor — bar 0 in full-history mode, the trade anchor otherwise.
  const profDate = new Date(candles[profile.anchorIndex].time * 1000).toISOString().slice(0, 10);
  const rangeLabel = model.fitProfileRange ? `Full history (since ${profDate})` : profDate;

  const stat = (k: string, v: string) =>
    `<div class="stat"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  els.summary.innerHTML = [
    stat("Price", formatPrice(currentPrice)),
    stat("POC", formatPrice(profile.poc.mid)),
    stat("Value area", `${formatPrice(profile.valueArea.low)}–${formatPrice(profile.valueArea.high)}`),
    stat("Total volume", formatVolume(profile.totalVolume)),
    stat("Profile covers", rangeLabel),
    stat("Shelves / gaps", `${analysis.shelves.length} / ${analysis.gaps.length}`),
  ].join("");

  // Zones: nearest demand & supply highlighted at top, then all shelves sorted by price desc.
  const shelves = [...analysis.shelves].sort((a, b) => b.priceHigh - a.priceHigh);
  // In full-history mode the zones map ALL past volume while the verdict/
  // thesis/plan panels read the anchored profile — say so, don't let the two
  // silently disagree.
  const fullNote = model.fitProfileRange
    ? `<p class="fc-note muted">Full-history map: every shelf price ever built, above and below. The verdict/thesis/plan panels still read the anchored profile (the trade).</p>`
    : "";
  if (shelves.length === 0) {
    els.zones.innerHTML = `${fullNote}<div class="empty">No significant shelves at this threshold.</div>`;
  } else {
    els.zones.innerHTML = fullNote + shelves
      .map((s) => {
        const cls =
          s.zone === "break-even-demand" ? "demand" : s.zone === "break-even-supply" ? "supply" : "neutral";
        const title =
          s.zone === "break-even-demand"
            ? "Break-even demand"
            : s.zone === "break-even-supply"
              ? "Break-even supply"
              : "Volume shelf (at price)";
        const dist = ((Math.abs(s.peakPrice - currentPrice) / currentPrice) * 100).toFixed(1);
        return `<div class="zone-row ${cls}">
          <div class="title"><span>${title}</span><span>${(s.fraction * 100).toFixed(1)}%</span></div>
          <div class="range">${formatPrice(s.priceLow)} – ${formatPrice(s.priceHigh)} · ${dist}% away</div>
          <div class="bar"><span style="width:${Math.min(100, s.fraction * 100 * 2.5)}%"></span></div>
        </div>`;
      })
      .join("");
  }

  if (analysis.gaps.length === 0) {
    els.gaps.innerHTML = `<div class="empty">No volume gaps at this threshold.</div>`;
  } else {
    els.gaps.innerHTML = analysis.gaps
      .sort((a, b) => b.priceHigh - a.priceHigh)
      .map(
        (g) =>
          `<div class="gap-row"><div class="range">${formatPrice(g.priceLow)} – ${formatPrice(
            g.priceHigh,
          )}</div><div class="empty">${(g.fraction * 100).toFixed(1)}% of volume — low friction</div></div>`,
      )
      .join("");
  }
}

// ---- data loading ----------------------------------------------------------
async function loadFromProvider(): Promise<void> {
  const provider = getProvider(els.provider.value);
  if (!provider) return;
  const symbol = els.symbol.value.trim() || (provider.id === "sample" ? "DEMO-SHELF" : "");
  if (!symbol) {
    setStatus("Enter a symbol", "error");
    return;
  }
  const apiKey = els.apiKey.value.trim();
  if (provider.requiresApiKey && !apiKey) {
    setStatus(`${provider.label} needs an API key`, "error");
    return;
  }
  if (apiKey) localStorage.setItem(LS.key(provider.id), apiKey);
  localStorage.setItem(LS.symbol, symbol);
  localStorage.setItem(LS.interval, els.interval.value);

  els.load.disabled = true;
  setStatus(`Loading ${symbol}…`);
  try {
    const candles = await provider.fetchCandles(
      { symbol, interval: els.interval.value as Interval },
      apiKey || undefined,
    );
    if (candles.length < 10) throw new Error("Not enough data returned");
    state.candles = candles;
    state.source = `${provider.label}: ${symbol}`;
    state.anchorMode = els.anchorMode.value as AnchorMode;
    recompute();
    afterLoad();
    setStatus(`${state.source} · ${candles.length} bars`, "ok");
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), "error");
  } finally {
    els.load.disabled = false;
  }
}

async function loadFromCsv(file: File): Promise<void> {
  setStatus(`Reading ${file.name}…`);
  try {
    const text = await file.text();
    const candles = parseCsv(text);
    state.candles = candles;
    state.source = file.name;
    state.anchorMode = els.anchorMode.value as AnchorMode;
    recompute();
    afterLoad();
    setStatus(`${file.name} · ${candles.length} bars`, "ok");
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), "error");
  }
}

// ---- timeframe + verdict ---------------------------------------------------
function activeTfBars(): number | null {
  const btn = els.tfBar.querySelector<HTMLButtonElement>(".tf[data-bars].active");
  const bars = btn ? Number(btn.dataset.bars) : 126;
  return bars > 0 ? bars : null;
}

function initTimeframe(): void {
  // Only the buttons with data-bars are timeframes (the ⛶ Focus toggle isn't).
  els.tfBar.querySelectorAll<HTMLButtonElement>(".tf[data-bars]").forEach((btn) => {
    btn.addEventListener("click", () => {
      els.tfBar.querySelectorAll(".tf[data-bars]").forEach((b) => b.classList.toggle("active", b === btn));
      const bars = Number(btn.dataset.bars);
      chart.setVisibleCount(bars > 0 ? bars : null);
      // Re-anchor and refresh the coach for the newly selected window.
      recompute();
    });
  });

  // Focus mode: hide the sidebar so the price graph gets the full width.
  const workspace = document.querySelector<HTMLElement>("#view-explore .workspace");
  const maxBtn = document.getElementById("chartMax");
  const applyFocus = (on: boolean) => {
    workspace?.classList.toggle("chart-max", on);
    maxBtn?.classList.toggle("active", on);
    localStorage.setItem("vs.focusExplore", on ? "1" : "0");
    chart.resize();
  };
  maxBtn?.addEventListener("click", () => applyFocus(!workspace?.classList.contains("chart-max")));
  if (localStorage.getItem("vs.focusExplore") === "1") applyFocus(true);
}

/**
 * Is the anchor bar nearer a local high or a local low? Used to label a manual
 * anchor so the scan reads it the same way the chart shows it.
 */
function isHighAnchorBar(candles: Candle[], index: number, look = 20): boolean {
  const n = candles.length;
  const lo = Math.max(0, index - look);
  const hi = Math.min(n - 1, index + look);
  let maxH = -Infinity;
  let minL = Infinity;
  for (let i = lo; i <= hi; i++) {
    if (candles[i].high > maxH) maxH = candles[i].high;
    if (candles[i].low < minL) minL = candles[i].low;
  }
  const bar = candles[index];
  return maxH - bar.high <= bar.low - minL; // closer to the top => a high anchor
}

/** Why the last explore scan produced nothing — surfaced instead of a blank panel. */
let exploreScanFailure = "";

/** Snapshot of the Explore tab's current read, for the chat coach. */
let exploreChatSnapshot = "";
registerChatContext("explore", () => exploreChatSnapshot);

/** Run the single-symbol scan on the chart's anchor (RS unknown, no benchmark). */
function runExploreScan(c: Candle[], anchorIndex: number, anchoredFromHigh: boolean): ScanResult | null {
  if (c.length < 20) {
    exploreScanFailure = `Not enough history to analyze — have ${c.length} bars, need 20+.`;
    return null;
  }
  try {
    const cfg = {
      ...DEFAULT_SCAN_CONFIG,
      rows: state.options.rowCount,
      scale: state.options.scale,
      valueAreaFraction: state.options.valueAreaFraction,
    };
    const forced: ChosenAnchor = {
      index: Math.min(Math.max(anchorIndex, 0), c.length - 1),
      label: anchoredFromHigh ? "swing-high" : "swing-low",
    };
    exploreScanFailure = "";
    return scanTicker({ ticker: "symbol", candles: c }, c, cfg, forced);
  } catch (err) {
    exploreScanFailure = `Analysis failed: ${err instanceof Error ? err.message : String(err)}`;
    return null;
  }
}

/** Render the verdict + confluence + bull/bear thesis + confirmation panels. */
function renderExploreReco(r: ScanResult | null): void {
  if (!r) {
    // Never blank the decision stack silently — say WHY there is no read.
    els.exploreReco.innerHTML = state.candles.length
      ? `<div class="panel"><h2>No analysis</h2><div class="empty">${exploreScanFailure || "Not enough history to analyze this symbol."}</div></div>`
      : "";
    exploreChatSnapshot = state.candles.length
      ? `Explore tab: ${state.source} is loaded but has no analysis — ${exploreScanFailure || "not enough history."}`
      : "";
    return;
  }
  const plan = buildTradePlan(r);
  const reco = recommend({ ...recoContextFromScan(r), rsOk: null }, plan);
  // Stage/MTF math is calibrated on daily bars; "52-week"/"1y" anchor windows
  // scale with the loaded interval so the labels stay honest.
  const isDaily = els.interval.value === "daily";
  const barsPerYear = ({ daily: 252, weekly: 52, monthly: 12 } as Record<string, number>)[els.interval.value] ?? 252;
  const shan = state.candles.length && isDaily ? shannonRead(state.candles, barsPerYear) : null;

  // Direction: mirror to the short side in a confirmed downtrend.
  const bearish = shan?.stage?.stage === 4 || (!r.gates.trend.pass && shan?.mtf.weekly === "down");
  const side: "long" | "short" = bearish ? "short" : "long";
  const activePlan = side === "short" ? buildShortPlan(r) : plan;

  // Explore has no benchmark loaded, so the regime is honest about not knowing.
  const regime: MarketRegime = {
    light: "unknown",
    stage: null,
    weekly: "neutral",
    detail: "Regime is read from the benchmark in the Scanner — run a scan there for the market light.",
  };
  const symbol = els.symbol.value.trim().toUpperCase() || r.ticker;
  const tape = state.candles.length ? anomalyScan(state.candles) : null;
  const disc = checkDiscipline({
    accountSize: Number(localStorage.getItem("vs.acct")) || 10000,
    tradeRiskFrac: (Number(localStorage.getItem("vs.riskpref")) || 1) / 100,
    symbol,
    side,
    rMultipleT1: activePlan?.rMultipleT1 ?? null,
    positions: loadPositions(),
    regime,
    tape: tape ? { level: tape.level, character: tape.character } : undefined,
    sectorExposure: {
      sector: sectorOf(symbol),
      openInSector: loadPositions().filter(
        (p) => p.status === "open" && sectorOf(p.symbol) === sectorOf(symbol),
      ).length,
    },
  });
  const fc = finalCall({
    side,
    reco,
    plan: activePlan,
    stage: shan?.stage ?? null,
    mtf: shan?.mtf ?? { weekly: "neutral", daily: "neutral", aligned: false, detail: "" },
    confluencePassed: r.confluence.passed,
    chasing: !!r.confluence.chasing,
    discipline: disc,
  });

  // "Would Heisenberg take this trade?" — calibrated on daily bars.
  let hbRead: HeisenbergRead | null = null;
  let hbWhy = "";
  if (!isDaily) hbWhy = "Calibrated on daily bars — switch Interval to Daily.";
  else if (state.candles.length < 60) hbWhy = `Needs ≥60 daily bars — have ${state.candles.length}.`;
  else {
    try {
      hbRead = heisenbergRead(state.candles);
    } catch (err) {
      hbWhy = `Heisenberg read failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // Snapshot the whole on-screen read for the chat coach (plain text).
  const inst = state.candles.length ? institutionalRead(state.candles) : null;
  const early = state.candles.length ? earlySignal(state.candles) : null;
  exploreChatSnapshot = [
    `EXPLORE TAB — ${symbol} @ ${formatPrice(r.price)} (${state.source}, ${els.interval.value} bars, read as a ${side.toUpperCase()})`,
    `Final call: ${fc.call} — ${fc.headline}${fc.reasons.length ? ` Reasons: ${fc.reasons.join(" | ")}` : ""}`,
    `Verdict: ${reco.label} (${reco.confidence} confidence) — ${reco.headline} Why: ${reco.reasoning.join(" | ")}`,
    shan?.stage
      ? `Stage: ${shan.stage.stage} (${shan.stage.name}) — ${shan.stage.guidance} Timeframes: weekly ${shan.mtf.weekly}, daily ${shan.mtf.daily}${shan.mtf.aligned ? " (aligned)" : ""}.`
      : `Stage: unavailable (needs ~1 year of daily bars).`,
    `Confluence: ${r.confluence.passed}/10${r.confluence.chasing ? " — extended (chasing)" : ""}${r.confluence.reversionIntoStrength ? " — reversion-into-strength setup" : ""}.`,
    early ? `Early signal: ${early.grade} (${early.score.toFixed(0)}/100) — ${early.headline}` : "",
    inst ? `Institutional footprint: ${inst.rating} (${inst.verdict}) — ${inst.headline}` : "",
    tape ? `Tape: ${tape.level} / ${tape.character} — ${tape.headline}` : "Tape: unscreened.",
    (() => {
      const rtc = state.candles.length ? analyzeRetracement(state.candles) : null;
      return rtc ? `Dip grader: ${rtc.verdict.toUpperCase()} (${(rtc.depth * 100).toFixed(0)}% retraced, zone ${rtc.zone}) — ${rtc.headline}` : "";
    })(),
    hbRead
      ? `Heisenberg check (would @Mr_Derivatives take it?): ${hbRead.call} — ${hbRead.headline}${hbRead.best ? ` Setup: ${hbRead.best.name}.` : ""} Sizing: ${hbRead.sizing}`
      : `Heisenberg check: unavailable — ${hbWhy}`,
    activePlan
      ? `Plan (${side}): entry ${formatPrice(activePlan.entry)}, stop ${formatPrice(activePlan.stop)}, T1 ${formatPrice(activePlan.t1)}${activePlan.t1Synthetic ? " (synthetic ~3% marker, not a real level)" : ""} (${activePlan.rMultipleT1.toFixed(1)}R), T2 ${formatPrice(activePlan.t2)}${activePlan.t2Synthetic ? " (synthetic ~3% marker)" : ""} (${activePlan.rMultipleT2.toFixed(1)}R), risk ${(activePlan.riskPct * 100).toFixed(1)}%.`
      : `Plan: none — no support shelf to build one from.`,
    `Discipline guard: ${disc.verdict.toUpperCase()} (size ×${disc.sizeFactor})${
      disc.checks.some((c) => c.level !== "pass")
        ? ` — ${disc.checks.filter((c) => c.level !== "pass").map((c) => `${c.label}: ${c.message}`).join(" | ")}`
        : ""
    }`,
  ]
    .filter(Boolean)
    .join("\n");

  els.exploreReco.innerHTML =
    finalCallPanelHtml(fc) +
    recoPanelHtml(reco) +
    coachPanelHtml(nextSteps(reco, plan, r.price)) +
    anomalyPanelHtml(tape) +
    (state.candles.length ? institutionalPanelHtml(inst) : "") +
    (state.candles.length
      ? earlyPanelHtml(early, state.candles.length >= 320 ? earlySignal(resampleWeekly(state.candles)) : null)
      : "") +
    retracementPanelHtml(state.candles.length ? analyzeRetracement(state.candles) : null, r.price) +
    heisenbergPanelHtml(hbRead, hbWhy) +
    proofPanelHtml(exploreProof(symbol)) +
    disciplinePanelHtml(disc) +
    (shan
      ? shannonPanelHtml(shan, r.price)
      : !isDaily
        ? `<div class="panel"><h2>AVWAP map (Shannon)</h2><div class="empty">The stage/timeframe read is calibrated on daily bars — switch Interval to Daily for it.</div></div>`
        : "") +
    confluencePanelHtml(r.confluence) +
    thesisPanelHtml(buildThesis(r)) +
    confirmationPanelHtml(r.confirmation) +
    tradePlanPanelHtml(activePlan);
  wirePositionSizer(els.exploreReco, activePlan);
  wireTrackButton(
    els.exploreReco,
    symbol,
    activePlan,
    () => setStatus(`${symbol} ${side === "short" ? "short " : ""}tracked — see Scanner → Positions for live P&L in R.`, "ok"),
    {
      call: fc.call,
      verdict: reco.verdict,
      early: early?.grade,
      tape: tape?.character,
      regime: regime.light,
      side,
    },
  );
  // One party per symbol per session — recompute() re-renders on every slider tweak.
  if ((fc.call === "GO" || fc.call === "GO-HALF") && !celebratedSymbols.has(symbol)) {
    celebratedSymbols.add(symbol);
    celebrate(`${symbol} is a ${fc.call}${side === "short" ? " · SHORT" : ""} — follow the plan! 🚀`);
  }
}
const celebratedSymbols = new Set<string>();

// The proof replay is O(n²)-ish; recompute() fires on every slider tweak, so
// cache per (symbol, history length) and reuse.
let proofKey = "";
let proofValue: SignalProof | null = null;
function exploreProof(symbol: string): SignalProof | null {
  const key = `${symbol}:${state.candles.length}`;
  if (key !== proofKey) {
    proofKey = key;
    const stride = Math.max(2, Math.floor((state.candles.length - 90) / 400));
    proofValue = state.candles.length ? proveEarlySignal(state.candles, 20, 70, stride) : null;
  }
  return proofValue;
}

/** AVWAP line + ±1σ bands, the pinch AVWAPs, 50/200 MA and the trade levels. */
function buildExploreOverlays(c: Candle[], anchorIndex: number, r: ScanResult): ChartOverlays {
  const closes = c.map((x) => x.close);
  const bands = anchoredVwapBands(c, anchorIndex, 1);
  const bands2 = anchoredVwapBands(c, anchorIndex, 2);
  const series = [
    // ±2σ = "extended": price up here is a take-profit / don't-chase zone; price
    // down here is the deep reversion-into-support zone.
    { label: "+2σ", values: bands2.upper, color: "rgba(239,83,80,0.18)", dashed: true },
    { label: "−2σ", values: bands2.lower, color: "rgba(38,166,154,0.18)", dashed: true },
    { label: "+1σ", values: bands.upper, color: "rgba(91,141,239,0.22)", dashed: true },
    { label: "−1σ", values: bands.lower, color: "rgba(91,141,239,0.22)", dashed: true },
    { label: "AVWAP", values: bands.vwap, color: "#5b8def" },
    { label: "50MA", values: smaSeries(closes, 50), color: "rgba(139,149,167,0.85)" },
    { label: "200MA", values: smaSeries(closes, 200), color: "rgba(239,83,80,0.65)" },
  ];
  // Add only the AVWAPs that form the pinch (confluence), to avoid clutter.
  const pinchLabels = new Set(r.pinch?.members.map((m) => m.label) ?? []);
  for (const a of r.avwapAnchors) {
    if (pinchLabels.has(a.label)) {
      series.push({ label: `AVWAP ${a.label}`, values: anchoredVwapSeries(c, a.index), color: "#c792ea" });
    }
  }
  // Shannon's two lines that matter most right now: the nearest event-anchored
  // AVWAP overhead (supply) and the nearest one underneath (support).
  const map = buildAvwapMap(c);
  const supply = map.filter((m) => m.role === "supply");
  const nearestSupply = supply[supply.length - 1];
  const nearestSupport = map.find((m) => m.role === "support");
  if (nearestSupply && nearestSupply.anchor.index !== anchorIndex) {
    series.push({
      label: `Supply · ${nearestSupply.anchor.label}`,
      values: anchoredVwapSeries(c, nearestSupply.anchor.index),
      color: "rgba(239,83,80,0.8)",
      dashed: true,
    });
  }
  if (nearestSupport && nearestSupport.anchor.index !== anchorIndex) {
    series.push({
      label: `Support · ${nearestSupport.anchor.label}`,
      values: anchoredVwapSeries(c, nearestSupport.anchor.index),
      color: "rgba(38,166,154,0.8)",
      dashed: true,
    });
  }
  const plan = buildTradePlan(r);
  const levels = plan
    ? [
        { label: `Entry ${formatPrice(plan.entry)}`, price: plan.entry, color: "#5b8def", dashed: true },
        { label: `Stop ${formatPrice(plan.stop)}`, price: plan.stop, color: "#ef5350", dashed: true },
        { label: `T1 ${formatPrice(plan.t1)}`, price: plan.t1, color: "#26a69a", dashed: true },
        { label: `T2 ${formatPrice(plan.t2)}`, price: plan.t2, color: "#26a69a", dashed: true },
      ]
    : [];
  return { series, levels };
}

/** Run after a new series loads: apply the timeframe and run the backtest model. */
function afterLoad(): void {
  chart.setVisibleCount(activeTfBars());
  updateModel();
}

/**
 * Run the point-in-time reversion backtest on the loaded symbol's own history
 * and render the deterministic TAKE / WATCH / STAND-ASIDE call + probability
 * table. Independent of the chart anchor (the model elects its own operative
 * anchor per bar), so it only recomputes on a new load, not on anchor tweaks.
 */
function updateModel(): void {
  const c = state.candles;
  // The backtest's windows (200-bar trend, 20-bar time stop…) are calibrated
  // in DAILY bars — running them on weekly/monthly bars silently reports
  // probabilities for a different game.
  if (els.interval.value !== "daily" || c.length < 260) {
    els.modelPanel.innerHTML = `<div class="panel model-panel"><div class="model-banner aside"><span class="mb-icon">⊘</span><span class="mb-label">MODEL</span></div><p class="model-why">Need ~260+ daily bars of history to backtest this symbol. Load more history (or a daily interval).</p></div>`;
    return;
  }
  try {
    const result = runBacktest(c, DEFAULT_BACKTEST_CONFIG);
    const tables = buildTables(result.trades, c, DEFAULT_BACKTEST_CONFIG);
    const rec = result.live ? decide(result.live, tables) : null;
    els.modelPanel.innerHTML = rec ? modelPanelHtml(rec, tables, result) : "";
  } catch {
    els.modelPanel.innerHTML = "";
  }
}

// Debounce the full recompute (it runs a whole scan) so dragging a slider on a
// long series stays smooth rather than re-scanning on every input tick.
let recomputeTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleRecompute(delay = 140): void {
  clearTimeout(recomputeTimer);
  recomputeTimer = setTimeout(recompute, delay);
}

// ---- options wiring --------------------------------------------------------
function persistOptions(): void {
  localStorage.setItem(LS.opts, JSON.stringify(state.options));
}

function syncOptionLabels(): void {
  els.rowsVal.textContent = String(state.options.rowCount);
  els.vaVal.textContent = `${Math.round(state.options.valueAreaFraction * 100)}%`;
}

function initControls(): void {
  // restore options
  try {
    const saved = JSON.parse(localStorage.getItem(LS.opts) ?? "null");
    if (saved && typeof saved === "object") state.options = { ...DEFAULT_OPTIONS, ...saved };
  } catch {
    /* ignore */
  }
  els.rows.value = String(state.options.rowCount);
  els.scale.value = state.options.scale;
  els.va.value = String(Math.round(state.options.valueAreaFraction * 100));
  els.symbol.value = localStorage.getItem(LS.symbol) ?? "";
  els.interval.value = localStorage.getItem(LS.interval) ?? "daily";
  syncOptionLabels();

  els.load.addEventListener("click", loadFromProvider);
  els.symbol.addEventListener("keydown", (e) => {
    if (e.key === "Enter") loadFromProvider();
  });
  els.apiKey.addEventListener("change", () => {
    const id = els.provider.value;
    if (els.apiKey.value.trim()) localStorage.setItem(LS.key(id), els.apiKey.value.trim());
  });

  els.csvBtn.addEventListener("click", () => els.csvInput.click());
  els.csvInput.addEventListener("change", () => {
    const file = els.csvInput.files?.[0];
    if (file) loadFromCsv(file);
    els.csvInput.value = "";
  });

  els.anchorMode.addEventListener("change", () => {
    state.anchorMode = els.anchorMode.value as AnchorMode;
    recompute();
  });
  els.profileRange.value = localStorage.getItem("vs.profileRange") ?? "anchored";
  state.profileRange = els.profileRange.value === "full" ? "full" : "anchored";
  els.profileRange.addEventListener("change", () => {
    state.profileRange = els.profileRange.value === "full" ? "full" : "anchored";
    localStorage.setItem("vs.profileRange", state.profileRange);
    recompute();
  });
  els.rows.addEventListener("input", () => {
    state.options.rowCount = Number(els.rows.value);
    syncOptionLabels();
    persistOptions();
    scheduleRecompute(); // debounce the full re-scan while dragging
  });
  els.scale.addEventListener("change", () => {
    state.options.scale = els.scale.value as AnalysisOptions["scale"];
    persistOptions();
    recompute();
  });
  els.va.addEventListener("input", () => {
    state.options.valueAreaFraction = Number(els.va.value) / 100;
    syncOptionLabels();
    persistOptions();
    scheduleRecompute();
  });
  for (const t of [els.tShelves, els.tGaps, els.tProfile, els.tVa]) {
    t.addEventListener("change", recompute);
  }
}

// ---- tabs ------------------------------------------------------------------
function initTabs(): void {
  const scanner = initScanner(setStatus);
  const tabs = document.querySelectorAll<HTMLButtonElement>(".tab");
  // Clicking a stock in the Rotation tab's industry browser opens it in the
  // Scanner detail pane.
  const toScanner = (ticker: string) => {
    document.querySelector<HTMLButtonElement>('.tab[data-view="scanner"]')?.click();
    scanner.select(ticker);
  };
  const rotation = initRotation(setStatus, scanner, toScanner);
  const playbooks = initPlaybooks(scanner, toScanner);
  const views: Record<string, HTMLElement> = {
    explore: $("view-explore"),
    scanner: $("view-scanner"),
    rotation: $("view-rotation"),
    playbooks: $("view-playbooks"),
  };
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const view = tab.dataset.view ?? "explore";
      tabs.forEach((t) => t.classList.toggle("active", t === tab));
      for (const [k, el] of Object.entries(views)) el.hidden = k !== view;
      if (view === "scanner") scanner.activate();
      else scanner.deactivate(); // stop the monitor's auto-refresh polling
      if (view === "rotation") rotation.activate();
      if (view === "playbooks") playbooks.activate();
      if (view === "explore") chart.resize();
    });
  });
}

// ---- boot ------------------------------------------------------------------
async function boot(): Promise<void> {
  initProviders();
  initControls();
  initTabs();
  initGuide();
  initTimeframe();
  initChat();
  chart.resize();
  // Initial render with offline demo data so the app is never blank.
  const demo = getProvider("sample")!;
  state.candles = await demo.fetchCandles({ symbol: "DEMO-SHELF", interval: "daily" });
  state.source = "Demo data";
  state.anchorMode = els.anchorMode.value as AnchorMode;
  recompute();
  afterLoad();
  setStatus("Demo data loaded · pick a source and Load a symbol", "ok");
}

boot();
