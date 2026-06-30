import {
  DEFAULT_SCAN_CONFIG,
  anchoredVwapSeries,
  buildTradePlan,
  detectGaps,
  scanUniverse,
  smaSeries,
  type ProfileAnalysis,
  type ScanConfig,
  type ScanInput,
  type ScanResult,
} from "./core";
import { VolumeShelfsChart, type ChartModel, type SeriesOverlay } from "./chart/chart";
import { formatPrice, formatVolume } from "./chart/scale";
import { PROVIDERS, getProvider, type Interval } from "./data";
import { buildDemoBenchmark, buildDemoUniverse } from "./data/universe";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const LS_KEY = (id: string) => `vs.key.${id}`;
const GATE_ORDER = ["liquidity", "trend", "rs", "shelf", "pinch", "contraction"] as const;
const GATE_SHORT: Record<string, string> = {
  liquidity: "Liq",
  trend: "Trend",
  rs: "RS",
  shelf: "Shelf",
  pinch: "Pinch",
  contraction: "Cont",
};

const AVWAP_COLORS = ["#5b8def", "#f5c842", "#26a69a", "#c879ef"];

interface ThresholdSpec {
  key: string;
  label: string;
  get: (c: ScanConfig) => number;
  set: (c: ScanConfig, v: number) => void;
  step: number;
  scale?: number; // display = value * scale
  suffix?: string;
}

const THRESHOLDS: ThresholdSpec[] = [
  { key: "minPrice", label: "Min price $", get: (c) => c.minPrice, set: (c, v) => (c.minPrice = v), step: 1 },
  { key: "minDollarVol", label: "Min $vol (M)", get: (c) => c.minDollarVol / 1e6, set: (c, v) => (c.minDollarVol = v * 1e6), step: 1 },
  { key: "shelfK", label: "Shelf k×mean", get: (c) => c.shelfK, set: (c, v) => (c.shelfK = v), step: 0.1 },
  { key: "proximityPct", label: "Proximity %", get: (c) => c.proximityPct * 100, set: (c, v) => (c.proximityPct = v / 100), step: 0.5 },
  { key: "pinchTolerance", label: "Pinch tol %", get: (c) => c.pinchTolerance * 100, set: (c, v) => (c.pinchTolerance = v / 100), step: 0.5 },
  { key: "near50maPct", label: "Near 50MA %", get: (c) => c.near50maPct * 100, set: (c, v) => (c.near50maPct = v / 100), step: 0.5 },
  { key: "rows", label: "Profile rows", get: (c) => c.rows, set: (c, v) => (c.rows = Math.round(v)), step: 5 },
];

const WEIGHTS: Array<{ key: keyof ScanConfig["weights"]; label: string }> = [
  { key: "shelf", label: "Shelf strength" },
  { key: "rs", label: "Rel. strength" },
  { key: "pinch", label: "AVWAP pinch" },
  { key: "proximity", label: "Proximity" },
  { key: "contraction", label: "Contraction" },
];

export interface ScannerUi {
  activate(): void;
  deactivate(): void;
}

export function initScanner(setStatus: (msg: string, kind?: "" | "ok" | "error") => void): ScannerUi {
  const config: ScanConfig = structuredClone(DEFAULT_SCAN_CONFIG);
  let source: "demo" | "live" = "demo";
  let results: ScanResult[] = [];
  let selected: string | null = null;
  let chart: VolumeShelfsChart | null = null;

  const els = {
    uniSource: $("uniSource"),
    tickerField: $("tickerField"),
    tickers: $<HTMLTextAreaElement>("tickers"),
    benchField: $("benchField"),
    benchmark: $<HTMLInputElement>("benchmark"),
    scanProviderField: $("scanProviderField"),
    scanProvider: $<HTMLSelectElement>("scanProvider"),
    scanKeyField: $("scanKeyField"),
    scanApiKey: $<HTMLInputElement>("scanApiKey"),
    runScan: $<HTMLButtonElement>("runScan"),
    advBtn: $<HTMLButtonElement>("advBtn"),
    advanced: $("advanced"),
    thresholds: $("thresholds"),
    weights: $("weights"),
    onlyPass: $<HTMLInputElement>("onlyPass"),
    resultsBody: $("resultsBody"),
    resultsEmpty: $("resultsEmpty"),
    table: $("resultsTable"),
    detailHead: $("detailHead"),
    detailPanels: $("detailPanels"),
  };

  // ---- provider dropdown (real providers only) --------------------------
  for (const p of PROVIDERS.filter((p) => p.id !== "sample")) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.label;
    els.scanProvider.appendChild(opt);
  }
  const syncProviderKey = () => {
    const p = getProvider(els.scanProvider.value);
    els.scanKeyField.hidden = !p?.requiresApiKey;
    if (p) els.scanApiKey.value = localStorage.getItem(LS_KEY(p.id)) ?? "";
  };
  els.scanProvider.addEventListener("change", syncProviderKey);
  syncProviderKey();

  // ---- universe source toggle -------------------------------------------
  els.uniSource.querySelectorAll<HTMLButtonElement>(".seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      source = btn.dataset.src === "live" ? "live" : "demo";
      els.uniSource.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
      const live = source === "live";
      els.tickerField.hidden = !live;
      els.benchField.hidden = !live;
      els.scanProviderField.hidden = !live;
      els.scanKeyField.hidden = !live || !getProvider(els.scanProvider.value)?.requiresApiKey;
    });
  });

  // ---- advanced controls -------------------------------------------------
  els.advBtn.addEventListener("click", () => {
    els.advanced.hidden = !els.advanced.hidden;
    els.advBtn.textContent = els.advanced.hidden ? "Filters ▾" : "Filters ▴";
  });
  for (const spec of THRESHOLDS) {
    const wrap = document.createElement("label");
    wrap.className = "adv-item";
    const input = document.createElement("input");
    input.type = "number";
    input.step = String(spec.step);
    input.value = String(round(spec.get(config)));
    input.addEventListener("change", () => {
      const v = Number(input.value);
      if (Number.isFinite(v)) spec.set(config, v);
    });
    wrap.append(label(spec.label), input);
    els.thresholds.appendChild(wrap);
  }
  for (const w of WEIGHTS) {
    const wrap = document.createElement("label");
    wrap.className = "adv-item";
    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = "3";
    input.step = "0.25";
    input.value = String(config.weights[w.key]);
    const val = document.createElement("span");
    val.className = "muted";
    val.textContent = input.value;
    input.addEventListener("input", () => {
      config.weights[w.key] = Number(input.value);
      val.textContent = input.value;
      if (results.length) rankAndRender();
    });
    wrap.append(label(w.label), input, val);
    els.weights.appendChild(wrap);
  }

  els.onlyPass.addEventListener("change", renderTable);
  els.runScan.addEventListener("click", () => void run());

  // ---- run ---------------------------------------------------------------
  let lastInputs: ScanInput[] = [];
  let lastBenchmark = buildDemoBenchmark();

  async function run(): Promise<void> {
    els.runScan.disabled = true;
    try {
      if (source === "demo") {
        lastInputs = buildDemoUniverse().map((u) => ({ ticker: u.ticker, candles: u.candles }));
        lastBenchmark = buildDemoBenchmark();
        setStatus(`Scanning ${lastInputs.length} demo tickers…`);
      } else {
        await loadLiveUniverse();
      }
      rankAndRender();
      const pass = results.filter((r) => r.passedAll).length;
      setStatus(`Scanned ${results.length} · ${pass} A+ · ${results.length - pass} partial`, "ok");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err), "error");
    } finally {
      els.runScan.disabled = false;
    }
  }

  async function loadLiveUniverse(): Promise<void> {
    const provider = getProvider(els.scanProvider.value);
    if (!provider) throw new Error("Pick a data source");
    const apiKey = els.scanApiKey.value.trim();
    if (provider.requiresApiKey && !apiKey) throw new Error(`${provider.label} needs an API key`);
    if (apiKey) localStorage.setItem(LS_KEY(provider.id), apiKey);
    const symbols = els.tickers.value.split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (symbols.length === 0) throw new Error("Enter at least one ticker");

    const benchSym = els.benchmark.value.trim().toUpperCase() || "SPY";
    setStatus(`Fetching benchmark ${benchSym}…`);
    lastBenchmark = await provider.fetchCandles({ symbol: benchSym, interval: "daily" as Interval }, apiKey || undefined);

    const inputs: ScanInput[] = [];
    for (let i = 0; i < symbols.length; i++) {
      setStatus(`Fetching ${symbols[i]} (${i + 1}/${symbols.length})…`);
      try {
        const candles = await provider.fetchCandles({ symbol: symbols[i], interval: "daily" as Interval }, apiKey || undefined);
        if (candles.length >= 60) inputs.push({ ticker: symbols[i], candles });
      } catch {
        /* skip failed tickers; surfaced via count */
      }
    }
    if (inputs.length === 0) throw new Error("No tickers returned enough data");
    lastInputs = inputs;
  }

  function rankAndRender(): void {
    results = scanUniverse(lastInputs, lastBenchmark, config);
    renderTable();
    if (results.length > 0) {
      const stillThere = selected && results.find((r) => r.ticker === selected);
      select(stillThere ? selected! : results[0].ticker);
    }
  }

  // ---- results table -----------------------------------------------------
  function renderTable(): void {
    const rows = els.onlyPass.checked ? results.filter((r) => r.passedAll) : results;
    els.resultsEmpty.hidden = rows.length > 0;
    els.table.hidden = rows.length === 0;
    els.resultsBody.innerHTML = rows
      .map((r, i) => {
        const gates = GATE_ORDER.map(
          (g) => `<span class="gate ${r.gates[g].pass ? "on" : "off"}" title="${GATE_SHORT[g]}: ${escapeHtml(r.gates[g].detail)}">${GATE_SHORT[g]}</span>`,
        ).join("");
        const shelf = r.supportShelf
          ? `${r.supportShelf.priceLow.toFixed(2)}–${r.supportShelf.priceHigh.toFixed(2)} <span class="muted">${r.supportShelf.strength.toFixed(1)}×</span>`
          : "<span class='muted'>—</span>";
        const pinch = r.pinch ? `${(r.pinch.spread * 100).toFixed(1)}%${r.pinch.priceInside ? " ✓" : ""}` : "—";
        return `<tr data-ticker="${r.ticker}" class="${r.ticker === selected ? "sel" : ""}">
          <td class="muted">${i + 1}</td>
          <td class="tk">${r.ticker}${r.passedAll ? ' <span class="apex-badge">A+</span>' : ""}</td>
          <td><div class="scorebar"><span style="width:${r.score.toFixed(0)}%"></span></div><b>${r.score.toFixed(0)}</b></td>
          <td class="gates-cell">${gates}</td>
          <td>${formatPrice(r.price)}</td>
          <td class="${r.rs.excess3mo >= 0 ? "pos" : "neg"}">${fmtPct(r.rs.excess3mo)}</td>
          <td>${shelf}</td>
          <td>${pinch}</td>
        </tr>`;
      })
      .join("");
    els.resultsBody.querySelectorAll<HTMLTableRowElement>("tr").forEach((tr) => {
      tr.addEventListener("click", () => select(tr.dataset.ticker!));
    });
  }

  // ---- detail ------------------------------------------------------------
  function select(ticker: string): void {
    selected = ticker;
    els.resultsBody.querySelectorAll("tr").forEach((tr) =>
      tr.classList.toggle("sel", (tr as HTMLTableRowElement).dataset.ticker === ticker),
    );
    const r = results.find((x) => x.ticker === ticker);
    if (!r) return;
    renderDetail(r);
  }

  function renderDetail(r: ScanResult): void {
    els.detailHead.innerHTML = `<h2>${r.ticker} <span class="score-pill">score ${r.score.toFixed(0)}</span>${r.passedAll ? ' <span class="apex-badge">A+</span>' : ""}</h2>
      <p class="muted">Anchored at ${r.anchor.label} · ${r.shelves.length} shelves · POC ${formatPrice(r.profile.poc.mid)} · ${r.gatesPassed}/6 gates</p>`;

    if (!chart) chart = new VolumeShelfsChart($<HTMLCanvasElement>("scanChart"));
    chart.setModel(buildChartModel(r));
    chart.resize();

    els.detailPanels.innerHTML = gatesPanel(r) + tradePlanPanel(r) + checklistPanel(r);
  }

  function buildChartModel(r: ScanResult): ChartModel {
    const candles = lastInputs.find((i) => i.ticker === r.ticker)?.candles ?? [];
    const analysis: ProfileAnalysis = {
      shelves: r.shelves,
      gaps: detectGaps(r.profile, { shelfThreshold: 0.55, gapThreshold: 0.15 }),
      nearestDemand: r.nearest.below,
      nearestSupply: r.nearest.above,
    };
    const closeArr = candles.map((c) => c.close);
    const series: SeriesOverlay[] = [];
    r.avwapAnchors.forEach((a, i) => {
      const inPinch = r.pinch?.members.some((m) => m.label === a.label) ?? false;
      series.push({
        label: `AVWAP ${a.label}`,
        values: anchoredVwapSeries(candles, a.index),
        color: AVWAP_COLORS[i % AVWAP_COLORS.length],
        dashed: !inPinch,
      });
    });
    series.push({ label: "50MA", values: smaSeries(closeArr, 50), color: "rgba(139,149,167,0.9)" });
    series.push({ label: "200MA", values: smaSeries(closeArr, 200), color: "rgba(239,83,80,0.7)" });

    const plan = buildTradePlan(r);
    const levels = plan
      ? [
          { label: `Entry ${formatPrice(plan.entry)}`, price: plan.entry, color: "#5b8def", dashed: true },
          { label: `Stop ${formatPrice(plan.stop)}`, price: plan.stop, color: "#ef5350", dashed: true },
          { label: `T1 ${formatPrice(plan.t1)}`, price: plan.t1, color: "#26a69a", dashed: true },
          { label: `T2 ${formatPrice(plan.t2)}`, price: plan.t2, color: "#26a69a", dashed: true },
        ]
      : [];

    return {
      candles,
      profile: r.profile,
      analysis,
      anchorIndex: r.anchor.index,
      currentPrice: r.price,
      show: { profile: true, shelves: true, gaps: true, valueArea: false },
      overlays: { series, levels },
    };
  }

  function gatesPanel(r: ScanResult): string {
    const rows = GATE_ORDER.map((g) => {
      const gate = r.gates[g];
      return `<div class="gate-row ${gate.pass ? "pass" : "fail"}">
        <span class="dot"></span><span class="gl">${gate.label}</span>
        <span class="gd muted">${escapeHtml(gate.detail)}</span></div>`;
    }).join("");
    return `<div class="panel"><h2>Gates (${r.gatesPassed}/6)</h2>${rows}</div>`;
  }

  function tradePlanPanel(r: ScanResult): string {
    const plan = buildTradePlan(r);
    if (!plan) return `<div class="panel"><h2>Trade plan</h2><div class="empty">No support shelf — not actionable as a long.</div></div>`;
    const lvl = (k: string, v: number, cls = "") => `<div class="stat"><span class="k">${k}</span><span class="v ${cls}">${formatPrice(v)}</span></div>`;
    const notes = plan.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("");
    return `<div class="panel"><h2>Trade plan</h2>
      <div class="summary">
        ${lvl("Entry (reclaim)", plan.entry)}
        ${lvl("Stop (shelf low)", plan.stop, "neg")}
        ${lvl("T1 (POC/HVN)", plan.t1, "pos")}
        ${lvl("T2 (VAH+)", plan.t2, "pos")}
        <div class="stat"><span class="k">Risk</span><span class="v">${(plan.riskPct * 100).toFixed(1)}%</span></div>
        <div class="stat"><span class="k">R to T1 / T2</span><span class="v">${plan.rMultipleT1.toFixed(1)}R / ${plan.rMultipleT2.toFixed(1)}R</span></div>
      </div>
      <ul class="notes">${notes}</ul></div>`;
  }

  function checklistPanel(r: ScanResult): string {
    const items = [
      "Shelf lines up with a level you'd have drawn by hand",
      "Price has bounced/rejected at this shelf before (the level is real)",
      "Volume shelf and AVWAP pinch overlap or sit close",
      "Clean structure: higher lows into the shelf, not messy chop",
      "No earnings/catalyst inside the intended hold window",
      "Watchlist it and let it set up — don't chase day one",
    ];
    const lis = items
      .map((t, i) => `<label class="chk man"><input type="checkbox" data-k="${r.ticker}-${i}" /> ${t}</label>`)
      .join("");
    return `<div class="panel"><h2>Manual confirmation</h2><div class="checklist">${lis}</div></div>`;
  }

  // ---- helpers -----------------------------------------------------------
  function label(text: string): HTMLSpanElement {
    const s = document.createElement("span");
    s.textContent = text;
    return s;
  }

  return {
    activate() {
      if (results.length === 0) void run();
      else chart?.resize();
    },
    deactivate() {},
  };
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
function fmtPct(v: number): string {
  return Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%` : "—";
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
// re-exported for parity with chart formatting
export { formatVolume };
