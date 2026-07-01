import {
  DEFAULT_SCAN_CONFIG,
  anchoredVwapBands,
  anchoredVwapSeries,
  buildThesis,
  buildTradePlan,
  defaultAnchorHighIndex,
  defaultAnchorIndex,
  detectGaps,
  recoContextFromScan,
  recommend,
  scanTicker,
  scanUniverse,
  smaSeries,
  type ChosenAnchor,
  type ProfileAnalysis,
  type ScanConfig,
  type ScanInput,
  type ScanResult,
} from "./core";
import { VolumeShelfsChart, type ChartModel, type SeriesOverlay } from "./chart/chart";
import { formatPrice, formatVolume } from "./chart/scale";
import { PROVIDERS, getProvider, type Interval } from "./data";
import { buildDemoBenchmark, buildDemoUniverse } from "./data/universe";
import { GATE_GLOSSARY } from "./glossary";
import { recoPanelHtml } from "./reco-view";
import { confirmationPanelHtml, confluencePanelHtml, thesisPanelHtml } from "./thesis-view";
import { tradePlanPanelHtml, wirePositionSizer } from "./trade-view";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const LS_KEY = (id: string) => `vs.key.${id}`;
const GATE_ORDER = ["liquidity", "trend", "rs", "shelf", "gap", "avwap", "contraction"] as const;
const GATE_SHORT: Record<string, string> = {
  liquidity: "Liq",
  trend: "Trend",
  rs: "RS",
  shelf: "Shelf",
  gap: "Gap",
  avwap: "AVWAP",
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
  { key: "ideal", label: "Ideal shelf" },
  { key: "gap", label: "Gap play" },
  { key: "rs", label: "Rel. strength" },
  { key: "avwap", label: "AVWAP" },
  { key: "pinch", label: "AVWAP pinch" },
  { key: "contraction", label: "Contraction" },
  { key: "confluence", label: "Confluence" },
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
    exportCsv: $<HTMLButtonElement>("exportCsv"),
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

  // Restore the saved watchlist + benchmark so users don't retype every time.
  els.tickers.value = localStorage.getItem("vs.tickers") ?? "";
  const savedBench = localStorage.getItem("vs.bench");
  if (savedBench) els.benchmark.value = savedBench;

  // ---- provider dropdown (real providers only) --------------------------
  for (const p of PROVIDERS.filter((p) => p.id !== "sample")) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.label;
    els.scanProvider.appendChild(opt);
  }
  const syncProviderKey = () => {
    const p = getProvider(els.scanProvider.value);
    // Only reveal the key field in live mode (demo mode hides the whole source row).
    els.scanKeyField.hidden = source !== "live" || !p?.requiresApiKey;
    if (p) els.scanApiKey.value = localStorage.getItem(LS_KEY(p.id)) ?? "";
  };
  els.scanProvider.addEventListener("change", syncProviderKey);
  syncProviderKey();

  // ---- detail-chart timeframe bar ---------------------------------------
  const tfBarScan = $("tfBarScan");
  const activeScanTf = (): number | null => {
    const btn = tfBarScan.querySelector<HTMLButtonElement>(".tf.active");
    const bars = btn ? Number(btn.dataset.bars) : 126;
    return bars > 0 ? bars : null;
  };
  tfBarScan.querySelectorAll<HTMLButtonElement>(".tf").forEach((btn) => {
    btn.addEventListener("click", () => {
      tfBarScan.querySelectorAll(".tf").forEach((b) => b.classList.toggle("active", b === btn));
      const bars = Number(btn.dataset.bars);
      chart?.setVisibleCount(bars > 0 ? bars : null);
    });
  });

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
  els.exportCsv.addEventListener("click", exportResultsCsv);

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
    // Persist the watchlist + benchmark for next time.
    localStorage.setItem("vs.tickers", els.tickers.value);
    localStorage.setItem("vs.bench", benchSym);
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
        // No data-glossary in the row itself: a click on any cell must select
        // the ticker (the glossary lives on the detail panels + gate breakdown).
        const gates = GATE_ORDER.map(
          (g) => `<span class="gate ${r.gates[g].pass ? "on" : "off"}" title="${GATE_SHORT[g]}: ${escapeHtml(r.gates[g].detail)}">${GATE_SHORT[g]}</span>`,
        ).join("");
        const reco = recommend(recoContextFromScan(r), buildTradePlan(r));
        const shelf = r.supportShelf
          ? `${r.supportShelf.priceLow.toFixed(2)}–${r.supportShelf.priceHigh.toFixed(2)} <span class="muted">${r.supportShelf.strength.toFixed(1)}×</span>`
          : "<span class='muted'>—</span>";
        const gp = r.gapPlay;
        const play =
          gp && gp.active
            ? `<span class="play-badge">GAP ${(gp.airPocketPct * 100).toFixed(0)}% · ${gp.rr.toFixed(1)}R</span>`
            : r.idealScore >= 0.4
              ? `<span class="ideal-badge">Shelf ${(r.idealScore * 100).toFixed(0)}</span>`
              : "<span class='muted'>—</span>";
        return `<tr data-ticker="${r.ticker}" class="${r.ticker === selected ? "sel" : ""}">
          <td class="muted">${i + 1}</td>
          <td class="tk">${r.ticker}${r.passedAll ? ' <span class="apex-badge">A+</span>' : ""}<div class="reco-chip reco-${reco.verdict}" title="${escapeHtml(reco.headline)}">${reco.label}</div></td>
          <td><div class="scorebar"><span style="width:${r.score.toFixed(0)}%"></span></div><b>${r.score.toFixed(0)}</b></td>
          <td><span class="cf-pill grade-${r.confluence.grade.replace("+", "plus")}" title="${r.confluence.passed}/10 confirmations${r.confluence.reversionIntoStrength ? " · reversion-into-strength" : r.confluence.chasing ? " · extended (chasing)" : ""}">${r.confluence.grade}<small>${r.confluence.passed}</small></span></td>
          <td class="gates-cell">${gates}</td>
          <td>${formatPrice(r.price)}</td>
          <td class="${r.rs.excess3mo >= 0 ? "pos" : "neg"}">${fmtPct(r.rs.excess3mo)}</td>
          <td>${shelf}</td>
          <td>${play}</td>
        </tr>`;
      })
      .join("");
    els.resultsBody.querySelectorAll<HTMLTableRowElement>("tr").forEach((tr) => {
      tr.addEventListener("click", () => select(tr.dataset.ticker!));
    });
  }

  /** Download the current ranked results as a CSV (the "top setups" list). */
  function exportResultsCsv(): void {
    const rows = els.onlyPass.checked ? results.filter((r) => r.passedAll) : results;
    if (rows.length === 0) return;
    const header = [
      "Rank", "Ticker", "Score", "Confluence", "N/10", "Gates", "Verdict", "Call",
      "Price", "Shelf", "Strength", "RS3mo%", "Reversion", "Chasing",
    ];
    const body = rows.map((r, i) => {
      const reco = recommend(recoContextFromScan(r), buildTradePlan(r));
      const shelf = r.supportShelf
        ? `${r.supportShelf.priceLow.toFixed(2)}-${r.supportShelf.priceHigh.toFixed(2)}`
        : "";
      return [
        i + 1, r.ticker, r.score.toFixed(0), r.confluence.grade, r.confluence.passed,
        `${r.gatesPassed}/7`, reco.label, reco.headline, r.price.toFixed(2), shelf,
        r.supportShelf ? r.supportShelf.strength.toFixed(1) : "",
        (r.rs.excess3mo * 100).toFixed(1),
        r.confluence.reversionIntoStrength ? "yes" : "",
        r.confluence.chasing ? "yes" : "",
      ];
    });
    const csv = [header, ...body].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "volumeshelfs-scan.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---- detail ------------------------------------------------------------
  /** Anchor override for the currently open detail (the "try the other anchor" toggle). */
  let detailOverride: ChosenAnchor | null = null;

  function select(ticker: string): void {
    selected = ticker;
    detailOverride = null; // reset to the app's pick when switching tickers
    els.resultsBody.querySelectorAll("tr").forEach((tr) =>
      tr.classList.toggle("sel", (tr as HTMLTableRowElement).dataset.ticker === ticker),
    );
    renderSelectedDetail();
  }

  /** Render the detail for the selected ticker, honouring any anchor override. */
  function renderSelectedDetail(): void {
    const r = results.find((x) => x.ticker === selected);
    if (!r) return;
    const input = lastInputs.find((i) => i.ticker === selected);
    const dr = detailOverride && input ? scanTicker(input, lastBenchmark, config, detailOverride) : r;
    renderDetail(dr);
  }

  function renderDetail(r: ScanResult): void {
    const overridden = detailOverride !== null;
    const tag = overridden
      ? '<span class="alt-badge">alt anchor</span>'
      : `<span class="score-pill">score ${r.score.toFixed(0)}</span>${r.passedAll ? ' <span class="apex-badge">A+</span>' : ""}`;
    els.detailHead.innerHTML = `<h2>${r.ticker} ${tag}</h2>
      <p class="muted">Anchored at ${r.anchor.label}${r.anchoredFromHigh ? " (from high)" : ""} · ${r.shelves.length} shelves · POC ${formatPrice(r.profile.poc.mid)} · ${r.gatesPassed}/7 gates</p>`;

    if (!chart) chart = new VolumeShelfsChart($<HTMLCanvasElement>("scanChart"));
    chart.setModel(buildChartModel(r));
    chart.resize();
    chart.setVisibleCount(activeScanTf());

    els.detailPanels.innerHTML =
      recoPanel(r) +
      confluencePanelHtml(r.confluence) +
      mainPlayPanel(r) +
      thesisPanelHtml(buildThesis(r)) +
      anchorPanel(r) +
      avwapPanel(r) +
      confirmationPanelHtml(r.confirmation) +
      gatesPanel(r) +
      tradePlanPanelHtml(buildTradePlan(r)) +
      checklistPanel(r);

    // Wire the "try the other anchor" toggle.
    const candles = lastInputs.find((i) => i.ticker === r.ticker)?.candles ?? [];
    els.detailPanels.querySelector<HTMLButtonElement>("[data-anchor-other]")?.addEventListener("click", () => {
      const kind = els.detailPanels.querySelector<HTMLButtonElement>("[data-anchor-other]")!.dataset.anchorOther;
      const index = kind === "high" ? defaultAnchorHighIndex(candles, 5, 20) : defaultAnchorIndex(candles, 5, 20);
      detailOverride = { index, label: kind === "high" ? "swing-high" : "swing-low" };
      renderSelectedDetail();
    });
    els.detailPanels.querySelector<HTMLButtonElement>("[data-anchor-reset]")?.addEventListener("click", () => {
      detailOverride = null;
      renderSelectedDetail();
    });

    // Wire the risk-based position sizer (recompute shares live, persist inputs).
    wirePositionSizer(els.detailPanels, buildTradePlan(r));
  }

  function anchorPanel(r: ScanResult): string {
    const candles = lastInputs.find((i) => i.ticker === r.ticker)?.candles ?? [];
    const bar = candles[r.anchor.index];
    if (!bar) return "";
    const price = r.anchoredFromHigh ? bar.high : bar.low;
    const date = new Date(bar.time * 1000).toISOString().slice(0, 10);
    const why = r.anchoredFromHigh
      ? `Anchored from the ${formatPrice(price)} swing high (${date}) — price fell off that high, so the heavy volume overhead is break-even supply it has to clear. The shelf at price is where it's trying to stabilize.`
      : `Anchored from the ${formatPrice(price)} swing low (${date}) — price built its base off that low, so the shelf at price is the break-even demand (support) underneath, and the volume above is the target.`;
    const otherKind = r.anchoredFromHigh ? "low" : "high";
    const toggle =
      detailOverride !== null
        ? `<button class="coach-btn" data-anchor-reset="1">↺ Back to the app's pick</button>`
        : `<button class="coach-btn ${otherKind}" data-anchor-other="${otherKind}"><span class="cb-flag">⚑</span> Try the swing ${otherKind} anchor</button>`;
    return `<div class="panel"><h2 data-glossary="anchor" title="What is an anchor? Click to learn">Why this anchor</h2>
      <p class="coach-why">${escapeHtml(why)}</p>
      <div class="coach-btns">${toggle}</div></div>`;
  }

  function recoPanel(r: ScanResult): string {
    return recoPanelHtml(recommend(recoContextFromScan(r), buildTradePlan(r)));
  }

  function mainPlayPanel(r: ScanResult): string {
    const gp = r.gapPlay;
    if (gp && gp.active) {
      return `<div class="panel play"><h2 data-glossary="gap-play" title="Click to learn">Main play · volume-gap traverse</h2>
        <p class="play-line">Hold the <b>${gp.entryShelf.priceLow.toFixed(2)}–${gp.entryShelf.priceHigh.toFixed(2)}</b> shelf, ride the
        <b>${(gp.airPocketPct * 100).toFixed(0)}%</b> air pocket to <b>${formatPrice(gp.target)}</b>${gp.targetShelf ? " (next shelf)" : ""}.</p>
        <div class="summary">
          <div class="stat"><span class="k">Entry</span><span class="v">${formatPrice(gp.entry)}</span></div>
          <div class="stat"><span class="k">Target</span><span class="v pos">${formatPrice(gp.target)}</span></div>
          <div class="stat"><span class="k">Stop</span><span class="v neg">${formatPrice(gp.stop)}</span></div>
          <div class="stat"><span class="k">Reward / R:R</span><span class="v">${(gp.rewardPct * 100).toFixed(0)}% · ${gp.rr.toFixed(1)}R</span></div>
        </div></div>`;
    }
    if (r.idealScore >= 0.4 && r.supportShelf) {
      const s = r.supportShelf;
      return `<div class="panel play"><h2 data-glossary="volume-shelf" title="Click to learn">Main play · shelf at price</h2>
        <p class="play-line">Price is pulling into the <b>${s.priceLow.toFixed(2)}–${s.priceHigh.toFixed(2)}</b> volume shelf
        (${s.strength.toFixed(1)}× mean)${r.anchoredFromHigh ? ", anchored from the dominant high" : ""}. Ideal score ${(r.idealScore * 100).toFixed(0)}.</p></div>`;
    }
    return `<div class="panel play"><h2>Main play</h2><div class="empty">No active volume-gap or shelf-at-price setup right now.</div></div>`;
  }

  function avwapPanel(r: ScanResult): string {
    const a = r.avwap;
    const st = a.keyState;
    const regimeCls = st.regime === "bullish" ? "pos" : st.regime === "bearish" ? "neg" : "";
    const ev =
      a.event === "reclaim"
        ? "reclaim ↑"
        : a.event === "loss"
          ? "loss ↓"
          : a.event.replace("holding-", "holding ");
    return `<div class="panel"><h2 data-glossary="avwap" title="Click to learn">AVWAP (Shannon)</h2>
      <div class="summary">
        <div class="stat"><span class="k">Anchor AVWAP</span><span class="v">${formatPrice(st.value)}</span></div>
        <div class="stat"><span class="k">Regime</span><span class="v ${regimeCls}">${st.regime}</span></div>
        <div class="stat"><span class="k">Slope · side</span><span class="v">${st.slope} · ${st.priceAbove ? "above" : "below"}</span></div>
        <div class="stat"><span class="k">Event</span><span class="v">${ev}</span></div>
        <div class="stat"><span class="k">Long AVWAP</span><span class="v ${a.bullish ? "pos" : ""}">${a.bullish ? "above rising" : a.reclaim ? "reclaim" : "below"}</span></div>
        <div class="stat"><span class="k">Pinch</span><span class="v">${r.pinch ? `${(r.pinch.spread * 100).toFixed(1)}%${r.pinch.priceInside ? " ✓" : ""}` : "—"}</span></div>
      </div></div>`;
  }

  function buildChartModel(r: ScanResult): ChartModel {
    const candles = lastInputs.find((i) => i.ticker === r.ticker)?.candles ?? [];
    // Show only the significant air pockets (top few by height) so the chart
    // stays readable rather than labelling every thin low-volume row.
    const allGaps = detectGaps(r.profile, { shelfThreshold: 0.55, gapThreshold: 0.15 });
    const gaps = allGaps
      .filter((g) => (g.priceHigh - g.priceLow) / r.price >= 0.05)
      .sort((a, b) => b.priceHigh - b.priceLow - (a.priceHigh - a.priceLow))
      .slice(0, 4);
    const analysis: ProfileAnalysis = {
      shelves: r.shelves,
      gaps,
      nearestDemand: r.nearest.below,
      nearestSupply: r.nearest.above,
    };
    const closeArr = candles.map((c) => c.close);
    const series: SeriesOverlay[] = [];
    // Shannon AVWAP std-dev bands + the key (break-even) AVWAP at the anchor,
    // plus only the AVWAPs that form a pinch (confluence) to avoid clutter.
    const bands = anchoredVwapBands(candles, r.anchor.index, 1);
    const bands2 = anchoredVwapBands(candles, r.anchor.index, 2);
    // ±2σ = extended (chase / deep-reversion) zone; ±1σ = the normal range.
    series.push({ label: "+2σ", values: bands2.upper, color: "rgba(239,83,80,0.18)", dashed: true });
    series.push({ label: "−2σ", values: bands2.lower, color: "rgba(38,166,154,0.18)", dashed: true });
    series.push({ label: "+1σ", values: bands.upper, color: "rgba(91,141,239,0.22)", dashed: true });
    series.push({ label: "−1σ", values: bands.lower, color: "rgba(91,141,239,0.22)", dashed: true });
    series.push({ label: "AVWAP", values: bands.vwap, color: "#5b8def" });
    const pinchLabels = new Set(r.pinch?.members.map((m) => m.label) ?? []);
    r.avwapAnchors
      .filter((a) => pinchLabels.has(a.label))
      .forEach((a, i) => {
        series.push({
          label: `AVWAP ${a.label}`,
          values: anchoredVwapSeries(candles, a.index),
          color: AVWAP_COLORS[(i + 1) % AVWAP_COLORS.length],
        });
      });
    series.push({ label: "50MA", values: smaSeries(closeArr, 50), color: "rgba(139,149,167,0.85)" });
    series.push({ label: "200MA", values: smaSeries(closeArr, 200), color: "rgba(239,83,80,0.65)" });

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
        <span class="dot"></span><span class="gl" data-glossary="${GATE_GLOSSARY[g]}" title="Click to learn">${gate.label}</span>
        <span class="gd muted">${escapeHtml(gate.detail)}</span></div>`;
    }).join("");
    return `<div class="panel"><h2>Gates (${r.gatesPassed}/7)</h2>${rows}</div>`;
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
/** Quote a CSV cell if it contains a comma, quote or newline. */
function csvCell(v: unknown): string {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
// re-exported for parity with chart formatting
export { formatVolume };
