/**
 * Standalone Trail page (trail.html): the quiet trail + signal indicator as
 * its own self-contained app — no VolumeShelfs tabs, no volume profile. Ships
 * with offline demo series and a CSV import (TradingView/Yahoo/Stooq style)
 * so it can run on real data with zero network access. Rendering is shared
 * with the in-app Trail tab via trail-view.ts.
 *
 * Build: `npm run build:trail` → dist-trail/ (single-entry bundle).
 * Dev:   `npm run dev` → http://localhost:5173/trail.html
 */
import "./trail-standalone.css";
import { trailRead, type Candle } from "./core";
import { VolumeShelfsChart } from "./chart/chart";
import { SAMPLE_DATASETS } from "./data/sample";
import { parseCsv } from "./data/csv";
import {
  buildTrailModel,
  emptyTrailModel,
  trailSignalsPanelHtml,
  trailStatePanelHtml,
  trailStatsPanelHtml,
} from "./trail-view";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

// localStorage may be unavailable in sandboxed embeds — degrade, don't die.
const LS_CSV = "trail.csv";
const LS_NAME = "trail.csvName";
function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* quota/sandbox — the import still works for this session */
  }
}

const els = {
  dataset: $<HTMLSelectElement>("dataset"),
  csvBtn: $<HTMLButtonElement>("csvBtn"),
  csvInput: $<HTMLInputElement>("csvInput"),
  status: $("status"),
  statePanel: $("statePanel"),
  statsPanel: $("statsPanel"),
  signalsPanel: $("signalsPanel"),
  tfBar: $("tfBar"),
};

const chart = new VolumeShelfsChart($<HTMLCanvasElement>("chart"));

const state: { candles: Candle[]; source: string } = { candles: [], source: "" };

function setStatus(msg: string, error = false): void {
  els.status.textContent = msg;
  els.status.className = `status${error ? " error" : ""}`;
}

function activeTfBars(): number | null {
  const btn = els.tfBar.querySelector<HTMLButtonElement>(".tf[data-bars].active");
  const bars = btn ? Number(btn.dataset.bars) : 126;
  return bars > 0 ? bars : null;
}

function render(): void {
  const { candles, source } = state;
  const read = candles.length >= 40 ? trailRead(candles) : null;

  if (!read) {
    chart.setModel(emptyTrailModel());
    els.statePanel.innerHTML = `<div class="panel"><h2>State</h2><div class="empty">${
      candles.length
        ? `Need 40+ daily bars for the trail read (have ${candles.length}).`
        : "Pick a demo series above, or import a daily OHLCV CSV."
    }</div></div>`;
    els.statsPanel.innerHTML = "";
    els.signalsPanel.innerHTML = "";
    setStatus(candles.length ? `${source} · ${candles.length} bars — not enough history` : "no data", true);
    return;
  }

  chart.setModel(buildTrailModel(candles, read));
  chart.setVisibleCount(activeTfBars());
  els.statePanel.innerHTML = trailStatePanelHtml(read, candles);
  els.statsPanel.innerHTML = trailStatsPanelHtml(read);
  els.signalsPanel.innerHTML = trailSignalsPanelHtml(read, candles);
  setStatus(`${source} · ${candles.length} bars · ${read.signals.length} signals`);
}

function loadDemo(symbol: string): void {
  const ds = SAMPLE_DATASETS.find((d) => d.symbol === symbol) ?? SAMPLE_DATASETS[0];
  state.candles = ds.candles;
  state.source = ds.symbol;
  render();
}

function loadCsvText(text: string, name: string): void {
  const candles = parseCsv(text); // throws DataError with a plain-English message
  state.candles = candles;
  state.source = name;
  render();
  lsSet(LS_CSV, text);
  lsSet(LS_NAME, name);
  els.dataset.value = "";
}

function init(): void {
  // Demo series picker: bundled offline datasets + a blank row while a CSV is loaded.
  els.dataset.innerHTML =
    `<option value="" hidden>imported CSV</option>` +
    SAMPLE_DATASETS.map((d) => `<option value="${d.symbol}">${d.label}</option>`).join("");
  els.dataset.addEventListener("change", () => {
    if (els.dataset.value) loadDemo(els.dataset.value);
  });

  els.csvBtn.addEventListener("click", () => els.csvInput.click());
  els.csvInput.addEventListener("change", async () => {
    const file = els.csvInput.files?.[0];
    els.csvInput.value = "";
    if (!file) return;
    try {
      loadCsvText(await file.text(), file.name);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err), true);
    }
  });

  els.tfBar.querySelectorAll<HTMLButtonElement>(".tf[data-bars]").forEach((btn) => {
    btn.addEventListener("click", () => {
      els.tfBar.querySelectorAll(".tf[data-bars]").forEach((b) => b.classList.toggle("active", b === btn));
      const bars = Number(btn.dataset.bars);
      chart.setVisibleCount(bars > 0 ? bars : null);
    });
  });

  chart.resize();

  // Boot: last imported CSV if this device has one, else the first demo series.
  const savedCsv = lsGet(LS_CSV);
  const savedName = lsGet(LS_NAME);
  if (savedCsv && savedName) {
    try {
      loadCsvText(savedCsv, savedName);
      return;
    } catch {
      /* stale/corrupt — fall through to demo */
    }
  }
  els.dataset.value = SAMPLE_DATASETS[0].symbol;
  loadDemo(SAMPLE_DATASETS[0].symbol);
}

init();
