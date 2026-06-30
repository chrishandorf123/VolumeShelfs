import "./styles.css";
import {
  DEFAULT_OPTIONS,
  analyzeProfile,
  computeAnchoredProfile,
  defaultAnchorIndex,
  detectSwings,
  type AnalysisOptions,
  type Candle,
} from "./core";
import { VolumeShelfsChart, type ChartModel } from "./chart/chart";
import { PROVIDERS, getProvider, parseCsv, type Interval } from "./data";
import { formatPrice, formatVolume } from "./chart/scale";
import { initScanner } from "./scanner-ui";

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
}

const state: State = {
  candles: [],
  anchorIndex: 0,
  anchorMode: "auto-low",
  options: { ...DEFAULT_OPTIONS },
  source: "",
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
function pickAnchor(): number {
  const c = state.candles;
  if (c.length === 0) return 0;
  if (state.anchorMode === "manual") {
    return Math.min(Math.max(state.anchorIndex, 0), c.length - 1);
  }
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
  if (state.anchorMode !== "manual") state.anchorIndex = pickAnchor();
  const anchor = Math.min(Math.max(state.anchorIndex, 0), c.length - 1);
  const currentPrice = c[c.length - 1].close;

  const profile = computeAnchoredProfile(c, anchor, {
    rowCount: state.options.rowCount,
    scale: state.options.scale,
    valueAreaFraction: state.options.valueAreaFraction,
  });
  const analysis = analyzeProfile(profile, currentPrice, {
    shelfThreshold: state.options.shelfThreshold,
    gapThreshold: state.options.gapThreshold,
  });

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
  };
  chart.setModel(model);
  renderSidebar(model);
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
  const { profile, analysis, currentPrice, candles, anchorIndex } = model;
  const anchorDate = new Date(candles[anchorIndex].time * 1000).toISOString().slice(0, 10);

  const stat = (k: string, v: string) =>
    `<div class="stat"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  els.summary.innerHTML = [
    stat("Price", formatPrice(currentPrice)),
    stat("POC", formatPrice(profile.poc.mid)),
    stat("Value area", `${formatPrice(profile.valueArea.low)}–${formatPrice(profile.valueArea.high)}`),
    stat("Total volume", formatVolume(profile.totalVolume)),
    stat("Anchored from", anchorDate),
    stat("Shelves / gaps", `${analysis.shelves.length} / ${analysis.gaps.length}`),
  ].join("");

  // Zones: nearest demand & supply highlighted at top, then all shelves sorted by price desc.
  const shelves = [...analysis.shelves].sort((a, b) => b.priceHigh - a.priceHigh);
  if (shelves.length === 0) {
    els.zones.innerHTML = `<div class="empty">No significant shelves at this threshold.</div>`;
  } else {
    els.zones.innerHTML = shelves
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
    setStatus(`${file.name} · ${candles.length} bars`, "ok");
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), "error");
  }
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
  els.rows.addEventListener("input", () => {
    state.options.rowCount = Number(els.rows.value);
    syncOptionLabels();
    persistOptions();
    recompute();
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
    recompute();
  });
  for (const t of [els.tShelves, els.tGaps, els.tProfile, els.tVa]) {
    t.addEventListener("change", recompute);
  }
}

// ---- tabs ------------------------------------------------------------------
function initTabs(): void {
  const scanner = initScanner(setStatus);
  const viewExplore = $("view-explore");
  const viewScanner = $("view-scanner");
  const tabs = document.querySelectorAll<HTMLButtonElement>(".tab");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const view = tab.dataset.view;
      tabs.forEach((t) => t.classList.toggle("active", t === tab));
      viewExplore.hidden = view !== "explore";
      viewScanner.hidden = view !== "scanner";
      if (view === "scanner") scanner.activate();
      else chart.resize();
    });
  });
}

// ---- boot ------------------------------------------------------------------
async function boot(): Promise<void> {
  initProviders();
  initControls();
  initTabs();
  chart.resize();
  // Initial render with offline demo data so the app is never blank.
  const demo = getProvider("sample")!;
  state.candles = await demo.fetchCandles({ symbol: "DEMO-SHELF", interval: "daily" });
  state.source = "Demo data";
  state.anchorMode = els.anchorMode.value as AnchorMode;
  recompute();
  setStatus("Demo data loaded · pick a source and Load a symbol", "ok");
}

boot();
