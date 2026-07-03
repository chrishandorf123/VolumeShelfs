import {
  DEFAULT_SCAN_CONFIG,
  anchoredVwapBands,
  anchoredVwapSeries,
  buildThesis,
  buildTradePlan,
  defaultAnchorHighIndex,
  defaultAnchorIndex,
  anomalyScan,
  buildShortPlan,
  checkDiscipline,
  closePosition,
  detectGaps,
  earlySignal,
  institutionalRead,
  finalCall,
  journalStats,
  markToMarket,
  marketRegime,
  monitorRow,
  nextSteps,
  pickTop,
  positionAdvice,
  projectGrowth,
  proveEarlySignal,
  realizedR,
  resampleWeekly,
  edgeBreakdown,
  sideOf,
  recoContextFromScan,
  recommend,
  rescoreUniverse,
  scanTicker,
  scanUniverse,
  shannonRead,
  smaSeries,
  sortMonitorRows,
  type AnomalyReport,
  type ChosenAnchor,
  type EarlySignal,
  type InstitutionalRead,
  type JournalStats,
  type MarketRegime,
  type MonitorRow,
  type Position,
  type MonitorStatus,
  type ProfileAnalysis,
  type Recommendation,
  type ScanConfig,
  type ScanInput,
  type ScanResult,
  type SignalProof,
  type TradePlan,
} from "./core";
import { VolumeShelfsChart, type ChartModel, type SeriesOverlay } from "./chart/chart";
import { formatPrice, formatVolume } from "./chart/scale";
import { PROVIDERS, getProvider, type Interval, type Quote } from "./data";
import { loadPositions, removePosition, updatePosition } from "./journal-store";
import { buildDemoBenchmark, buildDemoUniverse } from "./data/universe";
import { marketUniverse } from "./data/marketUniverse";
import { Pacer, minIntervalMs } from "./data/rateLimit";
import { GATE_GLOSSARY } from "./glossary";
import { coachPanelHtml } from "./coach-view";
import { recoPanelHtml } from "./reco-view";
import { shannonPanelHtml } from "./shannon-view";
import { wireTrackButton } from "./trade-view";
import { disciplinePanelHtml, finalCallPanelHtml, regimeChipHtml } from "./decision-view";
import { earlyPanelHtml, earlyPillHtml, proofPanelHtml } from "./early-view";
import { anomalyPanelHtml, institutionalPanelHtml, instPillHtml, tapeIconHtml } from "./tape-view";
import { celebrate } from "./celebrate";
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
  /** True while the Scanner tab is the visible view (gates monitor polling). */
  let viewActive = false;
  /** True while a live scan is fetching (monitor passes defer to it). */
  let scanRunning = false;
  /** Benchmark traffic light — refreshed on every scan, feeds the discipline guard. */
  let regime: MarketRegime = { light: "unknown", stage: null, weekly: "neutral", detail: "Run a scan to read the market regime." };
  /** Tickers already celebrated this session (one party per GO, not per click). */
  const celebrated = new Set<string>();

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
    loadUniverse: $<HTMLButtonElement>("loadUniverse"),
    keepTop: $<HTMLButtonElement>("keepTop"),
    tickerCount: $("tickerCount"),
    callsPerMin: $<HTMLInputElement>("callsPerMin"),
    rateField: $("rateField"),
    monitorSection: $("monitorSection"),
    monitorMeta: $("monitorMeta"),
    monitorBody: $("monitorBody"),
    monitorAuto: $<HTMLInputElement>("monitorAuto"),
    monitorNotify: $<HTMLInputElement>("monitorNotify"),
    monitorNow: $<HTMLButtonElement>("monitorNow"),
    digest: $("digest"),
    flowStrip: $("flowStrip"),
    positionsSection: $("positionsSection"),
    posMeta: $("posMeta"),
    posStats: $("posStats"),
    positionsBody: $("positionsBody"),
    regimeWrap: $("regimeWrap"),
    missionControl: $("missionControl"),
    posExport: $<HTMLButtonElement>("posExport"),
    rescanField: $("rescanField"),
    rescanEvery: $<HTMLSelectElement>("rescanEvery"),
  };

  // ONE pacer for ALL provider traffic (scan passes, monitor quotes and any
  // in-provider fallback calls), so overlapping loops can't multiply the
  // user's calls/min budget. Recreated only when the rate input changes.
  const currentCallsPerMin = () => Math.max(1, Math.min(1200, Number(els.callsPerMin.value) || 75));
  let sharedPacer = new Pacer(minIntervalMs(currentCallsPerMin()));

  // Reco + plan are needed by the table, digest, CSV export and monitor; compute
  // each ticker's once per ranking pass instead of once per consumer.
  let recoCache = new Map<string, { reco: Recommendation; plan: TradePlan | null }>();
  /** Early-signal / institutional / tape caches, same lifecycle as recoCache. */
  let earlyCache = new Map<string, EarlySignal | null>();
  let instCache = new Map<string, InstitutionalRead | null>();
  let tapeCache = new Map<string, AnomalyReport | null>();
  const candlesOf = (ticker: string) => lastInputs.find((i) => i.ticker === ticker)?.candles ?? [];
  function earlyOf(ticker: string): EarlySignal | null {
    if (!earlyCache.has(ticker)) {
      const candles = candlesOf(ticker);
      earlyCache.set(ticker, candles.length ? earlySignal(candles) : null);
    }
    return earlyCache.get(ticker) ?? null;
  }
  function instOf(ticker: string): InstitutionalRead | null {
    if (!instCache.has(ticker)) {
      const candles = candlesOf(ticker);
      instCache.set(ticker, candles.length ? institutionalRead(candles) : null);
    }
    return instCache.get(ticker) ?? null;
  }
  function tapeOf(ticker: string): AnomalyReport | null {
    if (!tapeCache.has(ticker)) {
      const candles = candlesOf(ticker);
      tapeCache.set(ticker, candles.length ? anomalyScan(candles) : null);
    }
    return tapeCache.get(ticker) ?? null;
  }
  /** Historical proof replay is O(n²)-ish — computed only on selection, cached. */
  let proofCache = new Map<string, SignalProof | null>();
  function proofOf(ticker: string): SignalProof | null {
    if (!proofCache.has(ticker)) {
      const candles = candlesOf(ticker);
      // Adaptive stride keeps the replay under ~400 samples on long histories.
      const stride = Math.max(2, Math.floor((candles.length - 90) / 400));
      proofCache.set(ticker, candles.length ? proveEarlySignal(candles, 20, 70, stride) : null);
    }
    return proofCache.get(ticker) ?? null;
  }
  function recoOf(r: ScanResult): { reco: Recommendation; plan: TradePlan | null } {
    let c = recoCache.get(r.ticker);
    if (!c) {
      const plan = buildTradePlan(r);
      c = { reco: recommend(recoContextFromScan(r), plan), plan };
      recoCache.set(r.ticker, c);
    }
    return c;
  }

  const tickerList = () =>
    els.tickers.value.split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
  const refreshTickerCount = () => {
    const n = tickerList().length;
    els.tickerCount.textContent = n ? `${n} ticker${n === 1 ? "" : "s"}` : "";
  };

  // Restore the saved watchlist + benchmark so users don't retype every time.
  els.tickers.value = localStorage.getItem("vs.tickers") ?? "";
  els.callsPerMin.value = localStorage.getItem("vs.callsPerMin") ?? "75";
  sharedPacer = new Pacer(minIntervalMs(currentCallsPerMin())); // honour the restored rate
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
    const btn = tfBarScan.querySelector<HTMLButtonElement>(".tf[data-bars].active");
    const bars = btn ? Number(btn.dataset.bars) : 126;
    return bars > 0 ? bars : null;
  };
  // Only the buttons with data-bars are timeframes (the ⛶ Focus toggle isn't).
  tfBarScan.querySelectorAll<HTMLButtonElement>(".tf[data-bars]").forEach((btn) => {
    btn.addEventListener("click", () => {
      tfBarScan.querySelectorAll(".tf[data-bars]").forEach((b) => b.classList.toggle("active", b === btn));
      const bars = Number(btn.dataset.bars);
      chart?.setVisibleCount(bars > 0 ? bars : null);
    });
  });

  // Focus mode: collapse the results list so the chart gets the full width.
  const scanWorkspace = document.querySelector<HTMLElement>("#view-scanner .scanner-workspace");
  const scanMaxBtn = $<HTMLButtonElement>("scanChartMax");
  const applyScanFocus = (on: boolean) => {
    scanWorkspace?.classList.toggle("chart-max", on);
    scanMaxBtn.classList.toggle("active", on);
    localStorage.setItem("vs.focusScan", on ? "1" : "0");
    chart?.resize();
  };
  scanMaxBtn.addEventListener("click", () => applyScanFocus(!scanWorkspace?.classList.contains("chart-max")));
  if (localStorage.getItem("vs.focusScan") === "1") applyScanFocus(true);

  // ---- universe source toggle -------------------------------------------
  els.uniSource.querySelectorAll<HTMLButtonElement>(".seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      source = btn.dataset.src === "live" ? "live" : "demo";
      els.uniSource.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
      const live = source === "live";
      els.tickerField.hidden = !live;
      els.benchField.hidden = !live;
      els.scanProviderField.hidden = !live;
      els.rateField.hidden = !live;
      els.rescanField.hidden = !live;
      els.scanKeyField.hidden = !live || !getProvider(els.scanProvider.value)?.requiresApiKey;
      syncMonitorVisibility();
      scheduleRescan();
    });
  });

  // ---- auto-rescan scheduler ----------------------------------------------
  // Re-runs the full universe scan on a timer (live mode, visible tab only).
  // Defers politely when the API budget is busy with a scan/monitor pass.
  let rescanTimer: number | null = null;
  function stopRescanTimer(): void {
    if (rescanTimer !== null) {
      clearTimeout(rescanTimer);
      rescanTimer = null;
    }
  }
  function scheduleRescan(): void {
    stopRescanTimer();
    const mins = Number(els.rescanEvery.value) || 0;
    if (!viewActive || source !== "live" || mins <= 0) return;
    const fire = (): void => {
      if (scanRunning || monitorRunning) {
        rescanTimer = window.setTimeout(fire, 60_000); // busy — try again in a minute
        return;
      }
      void run(); // run()'s finally re-arms the next cycle via scheduleRescan()
    };
    rescanTimer = window.setTimeout(fire, mins * 60_000);
  }
  els.rescanEvery.value = localStorage.getItem("vs.rescanEvery") ?? "0";
  els.rescanEvery.addEventListener("change", () => {
    localStorage.setItem("vs.rescanEvery", els.rescanEvery.value);
    scheduleRescan();
    const mins = Number(els.rescanEvery.value) || 0;
    setStatus(mins > 0 ? `Auto-rescan armed — full re-rank every ${mins} min.` : "Auto-rescan off.", "ok");
  });

  // ---- watchlist / universe helpers -------------------------------------
  refreshTickerCount();
  els.tickers.addEventListener("input", refreshTickerCount);
  els.callsPerMin.addEventListener("change", () => {
    localStorage.setItem("vs.callsPerMin", els.callsPerMin.value);
    sharedPacer = new Pacer(minIntervalMs(currentCallsPerMin()));
  });
  els.loadUniverse.addEventListener("click", () => {
    els.tickers.value = marketUniverse().join(" ");
    localStorage.setItem("vs.tickers", els.tickers.value);
    refreshTickerCount();
    setStatus(`Loaded ${marketUniverse().length} liquid names — press Run scan (paced to your calls/min).`, "ok");
  });
  els.keepTop.addEventListener("click", () => {
    if (results.length === 0) {
      setStatus("Run a scan first, then keep the top-ranked names.", "error");
      return;
    }
    const top = results.slice(0, 20).map((r) => r.ticker);
    els.tickers.value = top.join(" ");
    localStorage.setItem("vs.tickers", els.tickers.value);
    refreshTickerCount();
    setStatus(`Watchlist trimmed to the top ${top.length} ranked names.`, "ok");
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
      // Weights only change the score arithmetic — re-rank the existing
      // results; never re-run the (API-bound) universe scan from a slider.
      if (results.length) rescoreAndRender();
    });
    wrap.append(label(w.label), input, val);
    els.weights.appendChild(wrap);
  }

  els.onlyPass.addEventListener("change", renderTable);
  els.runScan.addEventListener("click", () => void run());
  els.exportCsv.addEventListener("click", exportResultsCsv);
  els.monitorNow.addEventListener("click", () => void runMonitor());
  // One delegated click handler for all monitor rows, across every re-render.
  els.monitorBody.addEventListener("click", (e) => {
    const del = (e.target as HTMLElement).closest<HTMLElement>("[data-alert-del]");
    if (del) {
      saveAlerts(loadAlerts().filter((a) => a.id !== del.dataset.alertDel));
      del.closest(".al-chip")?.remove();
      return;
    }
    const tr = (e.target as HTMLElement).closest<HTMLTableRowElement>("tr[data-ticker]");
    if (tr?.dataset.ticker) select(tr.dataset.ticker);
  });
  els.monitorAuto.checked = localStorage.getItem("vs.monAuto") === "1";
  els.monitorAuto.addEventListener("change", () => {
    localStorage.setItem("vs.monAuto", els.monitorAuto.checked ? "1" : "0");
    if (els.monitorAuto.checked) void runMonitor();
    else stopMonitorTimer();
  });
  els.monitorNotify.addEventListener("change", () => {
    if (!els.monitorNotify.checked) return;
    if (typeof Notification === "undefined") {
      els.monitorNotify.checked = false;
      setStatus("This browser doesn't support notifications.", "error");
      return;
    }
    if (Notification.permission === "denied") {
      els.monitorNotify.checked = false;
      setStatus("Notifications are blocked in the browser settings.", "error");
    } else if (Notification.permission === "default") {
      void Notification.requestPermission().then((p) => {
        if (p !== "granted") {
          els.monitorNotify.checked = false;
          setStatus("Notifications not allowed — trigger alerts will only show in the app.", "error");
        }
      });
    }
  });
  $("flowHide").addEventListener("click", () => {
    localStorage.setItem("vs.flowHidden", "1");
    els.flowStrip.hidden = true;
  });
  updateFlowStrip();

  /** Highlight where the user is in the scan → review → plan → monitor loop. */
  function updateFlowStrip(): void {
    if (localStorage.getItem("vs.flowHidden") === "1") {
      els.flowStrip.hidden = true;
      return;
    }
    els.flowStrip.hidden = false;
    const step = results.length === 0 ? 1 : lastStatuses.size > 0 ? 4 : selected ? 3 : 2;
    els.flowStrip.querySelectorAll<HTMLElement>(".fs-step").forEach((el) => {
      const n = Number(el.dataset.step);
      el.classList.toggle("done", n < step);
      el.classList.toggle("now", n === step);
    });
  }

  // ---- run ---------------------------------------------------------------
  let lastInputs: ScanInput[] = [];
  let lastBenchmark = buildDemoBenchmark();

  async function run(): Promise<void> {
    if (scanRunning) return;
    scanRunning = true;
    els.runScan.disabled = true;
    els.monitorNow.disabled = true; // scan and monitor share one API budget
    try {
      if (source === "demo") {
        lastInputs = buildDemoUniverse().map((u) => ({ ticker: u.ticker, candles: u.candles }));
        lastBenchmark = buildDemoBenchmark();
        setStatus(`Scanning ${lastInputs.length} demo tickers…`);
      } else {
        await loadLiveUniverse();
      }
      rankAndRender();
      resetMonitorState(); // new scan = new plans; old statuses/alerts don't apply
      syncMonitorVisibility();
      const pass = results.filter((r) => r.passedAll).length;
      setStatus(`Scanned ${results.length} · ${pass} A+ · ${results.length - pass} partial`, "ok");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err), "error");
    } finally {
      scanRunning = false;
      els.runScan.disabled = false;
      els.monitorNow.disabled = false;
      // A checked auto-refresh toggle should start watching as soon as there
      // is a live watchlist to watch (otherwise it could stay armed-but-idle).
      scheduleMonitor();
      scheduleRescan(); // arm the next full re-rank cycle
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

    // Pace requests to the provider's per-minute limit so a big universe scan
    // doesn't trip a 429. Each call is spaced ~60s / callsPerMin apart, and the
    // pacer is SHARED with the monitor so overlap can't exceed the budget.
    const callsPerMin = currentCallsPerMin();
    localStorage.setItem("vs.callsPerMin", String(callsPerMin));
    const etaMin = ((symbols.length + 1) / callsPerMin).toFixed(1);

    await sharedPacer.wait();
    setStatus(`Fetching benchmark ${benchSym}…`);
    lastBenchmark = await provider.fetchCandles({ symbol: benchSym, interval: "daily" as Interval }, apiKey || undefined);

    const inputs: ScanInput[] = [];
    let failed = 0;
    for (let i = 0; i < symbols.length; i++) {
      await sharedPacer.wait();
      setStatus(`Fetching ${symbols[i]} (${i + 1}/${symbols.length}) · ~${etaMin} min at ${callsPerMin}/min…`);
      try {
        const candles = await provider.fetchCandles({ symbol: symbols[i], interval: "daily" as Interval }, apiKey || undefined);
        if (candles.length >= 60) inputs.push({ ticker: symbols[i], candles });
        else failed += 1;
      } catch {
        failed += 1; // skip failed tickers; surfaced via count
      }
    }
    if (inputs.length === 0) throw new Error("No tickers returned enough data (check the key / rate limit)");
    if (failed > 0) setStatus(`${inputs.length} scanned, ${failed} skipped (no data / limit).`, "ok");
    lastInputs = inputs;
  }

  function rankAndRender(): void {
    results = scanUniverse(lastInputs, lastBenchmark, config);
    recoCache = new Map(); // results changed — recompute recos lazily
    earlyCache = new Map();
    instCache = new Map();
    tapeCache = new Map();
    proofCache = new Map();
    regime = marketRegime(lastBenchmark);
    els.regimeWrap.innerHTML = regimeChipHtml(regime);
    renderTable();
    renderDigest();
    renderMissionControl();
    if (results.length > 0) {
      const stillThere = selected && results.find((r) => r.ticker === selected);
      select(stillThere ? selected! : results[0].ticker);
    }
    updateFlowStrip();
  }

  /** Weight change: recompute scores + order only (analysis and recos are unchanged). */
  function rescoreAndRender(): void {
    results = rescoreUniverse(results, config.weights);
    renderTable();
    renderDigest();
  }

  // ---- "top trades right now" digest --------------------------------------
  // The guided answer to "what should I look at?": the best 3 actionable names
  // by verdict → gates → confidence → confluence → score, each with its call
  // and plan. Click a card to open the full detail.
  function renderDigest(): void {
    const picks = pickTop(
      results.map((r) => {
        const { reco } = recoOf(r);
        return {
          ticker: r.ticker,
          verdict: reco.verdict,
          confidence: reco.confidence,
          score: r.score,
          passedAll: r.passedAll,
          confluencePassed: r.confluence.passed,
        };
      }),
      3,
    );
    if (picks.length === 0) {
      els.digest.innerHTML = "";
      return;
    }
    const medals = ["①", "②", "③"];
    const cards = picks
      .map((p, i) => {
        const r = results.find((x) => x.ticker === p.ticker)!;
        const { reco, plan } = recoOf(r);
        const planLine = plan
          ? `<div class="dg-plan">Entry <b>${formatPrice(plan.entry)}</b> · Stop <b>${formatPrice(plan.stop)}</b> · T1 <b>${formatPrice(plan.t1)}</b> (${plan.rMultipleT1.toFixed(1)}R)</div>`
          : "";
        return `<button class="dg-card dg-${reco.verdict}" data-ticker="${p.ticker}" type="button">
          <div class="dg-top"><span class="dg-medal">${medals[i] ?? ""}</span><span class="dg-tk">${p.ticker}</span>
            <span class="reco-chip reco-${reco.verdict}">${reco.label}</span>
            ${r.passedAll ? '<span class="apex-badge">A+</span>' : ""}</div>
          <div class="dg-line">${escapeHtml(reco.headline)}</div>
          ${planLine}
        </button>`;
      })
      .join("");
    const anyBuy = picks.some((p) => p.verdict === "buy" || p.verdict === "buy-dip");
    const heading = anyBuy
      ? "Top trades right now"
      : "Nothing actionable yet — best names to stalk";

    // Stealth watch: the signal BEFORE the signal — names still pre-trigger
    // (no BUY verdict yet) whose early-accumulation tells are firing hardest.
    const stealth = results
      .filter((r) => {
        const v = recoOf(r).reco.verdict;
        return v !== "buy" && v !== "buy-dip" && v !== "avoid";
      })
      .map((r) => ({ r, sig: earlyOf(r.ticker) }))
      .filter((x): x is { r: ScanResult; sig: EarlySignal } => !!x.sig && x.sig.score >= 45)
      .sort((a, b) => b.sig.score - a.sig.score)
      .slice(0, 4);
    const stealthHtml = stealth.length
      ? `<div class="stealth-row"><span class="stealth-label">🕵️ Stealth watch <span class="muted">— loading before the trigger</span></span>
          ${stealth
            .map(
              (x) => `<button class="stealth-chip" type="button" data-ticker="${x.r.ticker}" title="${escapeHtml(x.sig.headline)}">
                ${x.r.ticker} ${earlyPillHtml(x.sig)}</button>`,
            )
            .join("")}</div>`
      : "";

    els.digest.innerHTML = `<div class="digest-head"><h3>${heading}</h3>
      <span class="muted">ranked by verdict → gates → confidence → confluence</span></div>
      <div class="digest-cards">${cards}</div>${stealthHtml}`;
    els.digest.querySelectorAll<HTMLButtonElement>(".dg-card, .stealth-chip").forEach((card) => {
      card.addEventListener("click", () => select(card.dataset.ticker!));
    });
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
        const { reco } = recoOf(r);
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
          <td class="tk">${r.ticker}${tapeIconHtml(tapeOf(r.ticker))}${r.passedAll ? ' <span class="apex-badge">A+</span>' : ""}<div class="reco-chip reco-${reco.verdict}" title="${escapeHtml(reco.headline)}">${reco.label}</div></td>
          <td><div class="scorebar"><span style="width:${r.score.toFixed(0)}%"></span></div><b>${r.score.toFixed(0)}</b></td>
          <td><span class="cf-pill grade-${r.confluence.grade.replace("+", "plus")}" title="${r.confluence.passed}/10 confirmations${r.confluence.reversionIntoStrength ? " · reversion-into-strength" : r.confluence.chasing ? " · extended (chasing)" : ""}">${r.confluence.grade}<small>${r.confluence.passed}</small></span></td>
          <td>${earlyPillHtml(earlyOf(r.ticker))}</td>
          <td>${instPillHtml(instOf(r.ticker))}</td>
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
      const { reco } = recoOf(r);
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

  // ---- live intraday monitor --------------------------------------------
  // Fetches a current quote (1 call each) for the ranked watchlist and reads
  // each name against its saved plan: is it still setting up (WATCH), poking
  // the trigger (APPROACHING/TRIGGERED), broken (STOPPED) or at a target (T1/T2)?
  const MONITOR_MAX = 30; // cap so one pass stays inside a reasonable window
  const MONITOR_GAP_MS = 30_000; // breather between auto-refresh passes
  let monitorTimer: number | null = null;
  let monitorRunning = false;

  // Status-change alerts: remember each name's last status so a pass can flag
  // transitions (WATCH → TRIGGERED etc.), flash the row and optionally notify.
  const lastStatuses = new Map<string, MonitorStatus>();
  const changedThisPass = new Set<string>();
  const alertsFeed: Array<{ time: string; symbol: string; from: MonitorStatus; to: MonitorStatus; note: string }> = [];
  const ALERTABLE: ReadonlySet<MonitorStatus> = new Set(["APPROACHING", "TRIGGERED", "T1", "T2", "STOPPED"]);

  function trackStatusChange(row: MonitorRow): void {
    const prev = lastStatuses.get(row.symbol);
    lastStatuses.set(row.symbol, row.status);
    // Only alert on a *transition* into an actionable state — the first pass
    // (prev undefined) just establishes the baseline quietly.
    if (prev === undefined || prev === row.status || !ALERTABLE.has(row.status)) return;
    changedThisPass.add(row.symbol);
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    alertsFeed.unshift({ time, symbol: row.symbol, from: prev, to: row.status, note: row.note });
    if (alertsFeed.length > 20) alertsFeed.length = 20;
    if (row.status === "TRIGGERED") celebrate(`${row.symbol} just fired its trigger! 💰`);
    if (els.monitorNotify.checked) beep();
    maybeNotify(row);
  }

  // ---- custom price alerts -------------------------------------------------
  // One-shot alerts checked against every quote the monitor fetches (watchlist,
  // positions, and any alert-only symbols get quoted too).
  interface PriceAlert {
    id: string;
    symbol: string;
    price: number;
    dir: "above" | "below";
  }
  const ALERTS_KEY = "vs.priceAlerts.v1";
  function loadAlerts(): PriceAlert[] {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(ALERTS_KEY) ?? "[]");
      return Array.isArray(parsed)
        ? parsed.filter((a): a is PriceAlert => !!a && typeof a.symbol === "string" && Number.isFinite(a.price))
        : [];
    } catch {
      return [];
    }
  }
  function saveAlerts(alerts: PriceAlert[]): void {
    localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts));
  }
  function checkPriceAlerts(q: Quote): void {
    const all = loadAlerts();
    const hit = all.filter(
      (a) => a.symbol === q.symbol && ((a.dir === "above" && q.price >= a.price) || (a.dir === "below" && q.price <= a.price)),
    );
    if (hit.length === 0) return;
    saveAlerts(all.filter((a) => !hit.includes(a))); // one-shot
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    for (const a of hit) {
      const note = `Price alert hit: ${a.dir} ${a.price.toFixed(2)} (now ${q.price.toFixed(2)}).`;
      alertsFeed.unshift({ time, symbol: a.symbol, from: "WATCH", to: "TRIGGERED", note });
      celebrate(`${a.symbol} hit your ${a.price.toFixed(2)} alert! 🔔`);
      if (els.monitorNotify.checked) {
        beep();
        if (typeof Notification !== "undefined" && Notification.permission === "granted")
          new Notification(`${a.symbol} 🔔`, { body: note });
      }
    }
    if (alertsFeed.length > 20) alertsFeed.length = 20;
  }

  /** A short synthesized ping for status-change alerts (opt-in via Notify). */
  function beep(): void {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.value = 0.06;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
      osc.stop(ctx.currentTime + 0.3);
      window.setTimeout(() => void ctx.close(), 400);
    } catch {
      // Audio blocked before a user gesture — the visual alert still lands.
    }
  }

  function maybeNotify(row: MonitorRow): void {
    if (!els.monitorNotify.checked || typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    new Notification(`${row.symbol} → ${row.status}`, { body: row.note });
  }

  function syncMonitorVisibility(): void {
    els.monitorSection.hidden = source !== "live";
    if (source !== "live") stopMonitorTimer();
  }

  /** New scan → new plans: old statuses, alerts and the stale table must go. */
  function resetMonitorState(): void {
    lastStatuses.clear();
    changedThisPass.clear();
    alertsFeed.length = 0;
    els.monitorMeta.textContent = "";
    els.monitorBody.innerHTML = `<div class="empty">Fresh scan — check prices to read the new plans intraday.</div>`;
  }

  function stopMonitorTimer(): void {
    if (monitorTimer !== null) {
      clearTimeout(monitorTimer);
      monitorTimer = null;
    }
  }

  /** Re-arm the next auto-refresh pass if the toggle is on and the tab is visible. */
  function scheduleMonitor(): void {
    stopMonitorTimer();
    if (viewActive && source === "live" && els.monitorAuto.checked && results.length > 0) {
      monitorTimer = window.setTimeout(() => void runMonitor(), MONITOR_GAP_MS);
      if (!els.monitorMeta.textContent.includes("auto in"))
        els.monitorMeta.textContent += ` · auto in ${Math.round(MONITOR_GAP_MS / 1000)}s`;
    }
  }

  /** The ranked names that have a concrete plan to watch (top MONITOR_MAX). */
  function monitorTargets(): Array<{ symbol: string; plan: TradePlan }> {
    const out: Array<{ symbol: string; plan: TradePlan }> = [];
    for (const r of results) {
      const { plan } = recoOf(r);
      if (plan) out.push({ symbol: r.ticker, plan });
      if (out.length >= MONITOR_MAX) break;
    }
    return out;
  }

  async function runMonitor(): Promise<void> {
    if (monitorRunning) return;
    if (scanRunning) {
      scheduleMonitor(); // the scan owns the API budget right now — retry after
      return;
    }
    if (!viewActive || source !== "live") {
      if (!viewActive) return; // fired from a stale timer while the tab is hidden
      setStatus("Switch to “Ticker list → API” and run a live scan to monitor prices.", "error");
      return;
    }
    const provider = getProvider(els.scanProvider.value);
    if (!provider?.fetchQuote) {
      setStatus(`${provider?.label ?? "This data source"} doesn't support live quotes.`, "error");
      return;
    }
    const apiKey = els.scanApiKey.value.trim();
    if (provider.requiresApiKey && !apiKey) {
      setStatus(`${provider.label} needs an API key for live quotes.`, "error");
      return;
    }
    const targets = monitorTargets();
    if (targets.length === 0) {
      setStatus("Run a scan first — the monitor watches the ranked names against their plans.", "error");
      return;
    }

    monitorRunning = true;
    els.monitorNow.disabled = true;
    els.runScan.disabled = true; // shared API budget — no scan mid-pass
    stopMonitorTimer();
    changedThisPass.clear();
    const rows: MonitorRow[] = [];
    const failures: Array<{ symbol: string; message: string }> = [];
    try {
      for (let i = 0; i < targets.length; i++) {
        // Re-check preconditions each iteration: the user may have left the
        // tab or switched to demo while the pass was mid-flight.
        if (!viewActive || source !== "live") break;
        await sharedPacer.wait();
        els.monitorMeta.textContent = `checking ${targets[i].symbol} (${i + 1}/${targets.length})…`;
        try {
          // The pace hook lets the provider take a fresh slot if a quote needs
          // a second HTTP request (e.g. the GLOBAL_QUOTE fallback).
          const q = await provider.fetchQuote(targets[i].symbol, apiKey || undefined, () => sharedPacer.wait());
          lastQuotes.set(q.symbol, q);
          checkPriceAlerts(q);
          const row = monitorRow(q, targets[i].plan);
          rows.push(row);
          trackStatusChange(row);
        } catch (err) {
          failures.push({
            symbol: targets[i].symbol,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
      // Also quote symbols the watchlist doesn't cover but the user cares
      // about: open journal positions and active price alerts.
      const extras = [...new Set([
        ...loadPositions().filter((p) => p.status === "open").map((p) => p.symbol),
        ...loadAlerts().map((a) => a.symbol),
      ])].filter((s) => !targets.some((t) => t.symbol === s));
      for (const sym of extras) {
        if (!viewActive || source !== "live") break;
        await sharedPacer.wait();
        els.monitorMeta.textContent = `checking ${sym} (position/alert)…`;
        try {
          const q = await provider.fetchQuote(sym, apiKey || undefined, () => sharedPacer.wait());
          lastQuotes.set(q.symbol, q);
          checkPriceAlerts(q);
        } catch (err) {
          failures.push({ symbol: sym, message: err instanceof Error ? err.message : String(err) });
        }
      }
      // Render once per pass (progress lives in the meta line above) — a
      // per-quote rebuild is O(n²) DOM work for no extra information.
      renderMonitor(sortMonitorRows(rows), failures, targets.length);
      renderPositions(); // open positions just got fresh marks
      const triggered = rows.filter((r) => r.status === "TRIGGERED" || r.status === "APPROACHING").length;
      setStatus(
        `Monitor: ${rows.length} quoted${failures.length ? `, ${failures.length} skipped` : ""} · ${triggered} at/near a trigger.`,
        rows.length === 0 && failures.length > 0 ? "error" : "ok",
      );
      updateFlowStrip();
    } finally {
      monitorRunning = false;
      els.monitorNow.disabled = false;
      els.runScan.disabled = scanRunning;
      // Re-arm the auto-refresh — unless the whole pass failed (bad key /
      // exhausted budget), where hammering the API every 30s helps nobody.
      if (rows.length > 0 || failures.length === 0) scheduleMonitor();
      else stopMonitorTimer();
    }
  }

  function renderMonitor(rows: MonitorRow[], failures: Array<{ symbol: string; message: string }>, total: number): void {
    // Freshness comes from the single most-recent row, so the live/close label
    // and the timestamp can't be mixed from two different symbols.
    const stampOf = (r: MonitorRow) => r.asOf || r.day || "";
    const newest = rows.reduce<MonitorRow | null>(
      (best, r) => (best === null || stampOf(r) > stampOf(best) ? r : best),
      null,
    );
    const freshness = newest && stampOf(newest)
      ? ` · ${newest.live ? "live" : "close"} ${stampOf(newest)}`
      : "";
    // Local wall-clock so the user can tell "old data" from "old check".
    const checked = ` · checked ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    const skipped = failures.length
      ? ` · ${failures.length} skipped: ${failures.slice(0, 3).map((f) => f.symbol).join(", ")}${failures.length > 3 ? "…" : ""}`
      : "";
    els.monitorMeta.textContent = rows.length
      ? `${rows.length}/${total} quoted${skipped}${freshness}${checked}`
      : "";
    els.monitorMeta.title = failures.length ? failures.map((f) => `${f.symbol}: ${f.message}`).join("\n") : "";
    // Standing price alerts, removable inline.
    const activeAlerts = loadAlerts();
    const alertsRow = activeAlerts.length
      ? `<div class="alerts-active">🔔 ${activeAlerts
          .map(
            (a) => `<span class="al-chip">${a.symbol} ${a.dir === "above" ? "≥" : "≤"} ${a.price.toFixed(2)}
              <button class="al-del" data-alert-del="${a.id}" type="button" title="Remove alert">✕</button></span>`,
          )
          .join("")}</div>`
      : "";
    if (rows.length === 0) {
      const first = failures[0];
      els.monitorBody.innerHTML = `${alertsRow}<div class="empty">No quotes returned${first ? ` — ${escapeHtml(`${first.symbol}: ${first.message}`)}` : " (check the key / rate limit)"}.</div>`;
      return;
    }
    // A row is stale when its live print trails the newest live print by >10
    // minutes (halted / thin names) — dim it and show its own time.
    const liveTimes = rows.filter((r) => r.live && r.asOf).map((r) => Date.parse(r.asOf!));
    const newestLive = liveTimes.length ? Math.max(...liveTimes) : NaN;
    const body = rows
      .map((r) => {
        const cls = r.status.toLowerCase();
        const chg = r.changePct >= 0 ? "pos" : "neg";
        const asOf = r.asOf ? ` title="${r.live ? "live" : "prior close"} · as of ${escapeHtml(r.asOf)}"` : "";
        const dot = r.live ? '<span class="mon-live" title="live intraday print">●</span> ' : "";
        const flash = changedThisPass.has(r.symbol) ? " mon-changed" : "";
        const rowTs = r.live && r.asOf ? Date.parse(r.asOf) : NaN;
        const isStale = Number.isFinite(newestLive) && Number.isFinite(rowTs) && newestLive - rowTs > 10 * 60_000;
        const staleTag = isStale ? ` <small class="mon-asof">${escapeHtml(r.asOf!.slice(11))}</small>` : "";
        const inR = Number.isFinite(r.toEntryR) ? ` <small class="muted">${Math.abs(r.toEntryR).toFixed(1)}R</small>` : "";
        return `<tr data-ticker="${r.symbol}" class="mon-row mon-${cls}${flash}${isStale ? " mon-stalerow" : ""}">
          <td><span class="mon-badge mon-${cls}">${r.status}</span></td>
          <td class="tk">${r.symbol}</td>
          <td${asOf}>${dot}${formatPrice(r.price)}${staleTag}</td>
          <td class="${chg}">${fmtPct(r.changePct)}</td>
          <td>${monArrow(r.toEntry)}${inR}</td>
          <td>${monArrow(r.toStop)}</td>
          <td>${monArrow(r.toT1)}</td>
          <td class="mon-note muted">${escapeHtml(r.note)}</td>
        </tr>`;
      })
      .join("");
    // The alert ribbon: the last few status transitions, newest first, so a
    // glance answers "what just happened?" even after stepping away.
    const feed = alertsFeed.length
      ? `<div class="mon-alerts">${alertsFeed
          .slice(0, 6)
          .map(
            (a) => `<div class="mon-alert"><span class="ma-time">${a.time}</span> <b>${a.symbol}</b>
              <span class="muted">${a.from} →</span> <span class="mon-badge mon-${a.to.toLowerCase()}">${a.to}</span>
              <span class="ma-note muted">${escapeHtml(a.note)}</span></div>`,
          )
          .join("")}</div>`
      : "";
    els.monitorBody.innerHTML = `${alertsRow}${feed}<table class="mon-table">
      <thead><tr>
        <th>Status</th><th>Ticker</th><th>Price</th><th>Today</th>
        <th title="Distance to the entry trigger (% of price, and in R — units of the plan's risk)">→Entry</th>
        <th title="Distance to the stop (invalidation)">→Stop</th>
        <th title="Distance to the first target">→T1</th>
        <th>Read</th>
      </tr></thead><tbody>${body}</tbody></table>`;
    // Row clicks use one delegated listener (wired at init) — no per-render churn.
  }

  // ---- positions journal ---------------------------------------------------
  // Trades the user chose to track ("📌 Track this trade"): live P&L in R,
  // what to do with each one now, and the running expectancy of following the
  // system — the feedback loop that tells you whether the edge is real.
  const lastQuotes = new Map<string, Quote>();

  const fmtR = (r: number) => (Number.isFinite(r) ? `${r >= 0 ? "+" : ""}${r.toFixed(2)}R` : "—");

  /** Best known current price for a symbol: live quote, else the scan's close. */
  function priceFor(symbol: string): number {
    const q = lastQuotes.get(symbol);
    if (q) return q.price;
    const r = results.find((x) => x.ticker === symbol);
    return r ? r.price : NaN;
  }

  /** Cumulative-R equity curve as an inline sparkline (needs ≥2 closed trades). */
  function equityCurveSvg(closedChrono: Position[]): string {
    const rs = closedChrono
      .map((p) => realizedR(p))
      .filter((r): r is number => r !== null && Number.isFinite(r));
    if (rs.length < 2) return "";
    let cum = 0;
    const pts = [0, ...rs.map((r) => (cum += r))];
    const min = Math.min(...pts, 0);
    const max = Math.max(...pts, 0.001);
    const W = 560;
    const H = 46;
    const pad = 3;
    const x = (i: number) => pad + (i / (pts.length - 1)) * (W - 2 * pad);
    const y = (v: number) => pad + (1 - (v - min) / (max - min)) * (H - 2 * pad);
    const line = pts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const last = pts[pts.length - 1];
    return `<div class="pos-curve"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1="${y(0).toFixed(1)}" x2="${W}" y2="${y(0).toFixed(1)}" class="pc-zero"/>
      <polyline points="${line}" class="pc-line ${last >= 0 ? "up" : "down"}"/>
    </svg><span class="pc-label">${fmtR(last)} · equity curve</span></div>`;
  }

  /** "If the next 100 trades look like your last N" — the measured edge, projected. */
  function projectionLine(stats: JournalStats): string {
    if (stats.closed < 10 || !Number.isFinite(stats.winRate)) return "";
    const riskFrac = (Number(localStorage.getItem("vs.riskpref")) || 1) / 100;
    const p = projectGrowth(
      { winRate: stats.winRate, avgWinR: stats.avgWinR, avgLossR: stats.avgLossR, riskFrac },
      100,
    );
    return `<div class="pos-proj">📐 If the next 100 trades look like your last ${stats.closed} at ${(riskFrac * 100).toFixed(1)}% risk:
      median <b>×${p.p50.toFixed(2)}</b> <span class="muted">(5%: ×${p.p05.toFixed(2)} · 95%: ×${p.p95.toFixed(2)})</span>
      · risk of losing half: <b class="${p.riskOfRuin > 0.05 ? "neg" : "pos"}">${(p.riskOfRuin * 100).toFixed(1)}%</b></div>`;
  }

  function renderPositions(): void {
    const positions = loadPositions();
    els.positionsSection.hidden = positions.length === 0;
    renderMissionControl();
    if (positions.length === 0) return;
    const stats = journalStats(positions);
    els.posMeta.textContent = stats.open
      ? `${stats.open} open · $${stats.openRisk.toFixed(0)} at risk`
      : `${stats.open} open`;
    els.posStats.textContent = stats.closed
      ? `${stats.closed} closed${Number.isFinite(stats.winRate) ? ` · ${(stats.winRate * 100).toFixed(0)}% win` : ""} · expectancy ${fmtR(stats.expectancyR)} · total ${fmtR(stats.totalR)}`
      : "";

    const open = positions.filter((p) => p.status === "open");
    const closed = positions.filter((p) => p.status === "closed").slice(-10).reverse();
    const rowsHtml = [...open, ...closed]
      .map((p) => {
        const isOpen = p.status === "open";
        const price = isOpen ? priceFor(p.symbol) : p.exitPrice!;
        const m = Number.isFinite(price) ? markToMarket(p, price) : null;
        const date = new Date(p.openedAt).toISOString().slice(0, 10);
        const badge = isOpen
          ? '<span class="mon-badge mon-triggered">OPEN</span>'
          : m && m.r > 0.05
            ? '<span class="mon-badge mon-t1">WIN</span>'
            : m && m.r < -0.05
              ? '<span class="mon-badge mon-stopped">LOSS</span>'
              : '<span class="mon-badge mon-watch">FLAT</span>';
        const pnlCls = m && m.pnl > 0 ? "pos" : m && m.pnl < 0 ? "neg" : "";
        const read = isOpen
          ? Number.isFinite(price)
            ? positionAdvice(p, price)
            : "No price yet — run the monitor to mark it."
          : `Closed at ${formatPrice(p.exitPrice!)}.`;
        const actions = isOpen
          ? `<button class="ghost pos-close" type="button" data-close="${p.id}" title="Close the position at a price you enter (defaults to the last known)">Close</button>`
          : "";
        return `<tr class="mon-row">
          <td>${badge}</td>
          <td class="tk">${p.symbol}${sideOf(p) === "short" ? ' <span class="side-tag">SHORT</span>' : ""}</td>
          <td class="muted">${date}</td>
          <td>${formatPrice(p.entry)} × ${p.shares}</td>
          <td class="neg">${formatPrice(p.stop)}</td>
          <td>${Number.isFinite(price) ? formatPrice(price) : "—"}</td>
          <td class="${pnlCls}">${m ? `$${m.pnl.toFixed(0)} · ${fmtR(m.r)}` : "—"}</td>
          <td class="mon-note muted">${escapeHtml(read)}</td>
          <td>${actions}<button class="ghost pos-del" type="button" data-del="${p.id}" title="Remove from the journal (does not affect stats of other rows)">✕</button></td>
        </tr>`;
      })
      .join("");
    const closedChrono = positions
      .filter((p) => p.status === "closed")
      .sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0));
    // Which signals pay THIS trader: avg R per signal bucket (n ≥ 2 to show).
    const buckets = edgeBreakdown(positions).filter((b) => b.n >= 2);
    const edgeHtml = buckets.length
      ? `<details class="edge-brk"><summary>🧠 Edge breakdown — which signals pay YOU</summary>
          <table class="mon-table"><thead><tr><th>Signal</th><th>Value</th><th>n</th><th>Avg R</th><th>Total R</th></tr></thead>
          <tbody>${buckets
            .map(
              (b) => `<tr><td class="muted">${escapeHtml(b.dimLabel)}</td><td class="tk">${escapeHtml(b.bucket)}</td>
                <td>${b.n}</td><td class="${b.avgR >= 0 ? "pos" : "neg"}">${fmtR(b.avgR)}</td>
                <td class="${b.totalR >= 0 ? "pos" : "neg"}">${fmtR(b.totalR)}</td></tr>`,
            )
            .join("")}</tbody></table>
          <p class="fc-note muted">Trades tagged at entry with the signals that were firing. Lean into the rows that pay; question the ones that don't.</p>
        </details>`
      : "";
    els.positionsBody.innerHTML = `${equityCurveSvg(closedChrono)}${projectionLine(stats)}${edgeHtml}<table class="mon-table">
      <thead><tr>
        <th></th><th>Ticker</th><th>Opened</th><th>Entry × sh</th><th>Stop</th>
        <th>Last / Exit</th><th title="Open (or realized) P&L in dollars and in R — units of the initial risk">P&L</th>
        <th>Read</th><th></th>
      </tr></thead><tbody>${rowsHtml}</tbody></table>`;
  }

  // ---- mission control -----------------------------------------------------
  // The "what should I do right now?" strip: market light, breadth, ready
  // setups, positions needing action, portfolio heat and the measured edge.
  function renderMissionControl(): void {
    const positions = loadPositions();
    const stats = journalStats(positions);
    const hasData = results.length > 0 || positions.length > 0;
    els.missionControl.hidden = !hasData;
    if (!hasData) return;

    const acct = Number(localStorage.getItem("vs.acct")) || 10000;
    const breadth = results.length
      ? results.filter((r) => r.gates.trend.pass).length / results.length
      : NaN;
    const ready = results.filter((r) => {
      const v = recoOf(r).reco.verdict;
      return v === "buy" || v === "buy-dip";
    });
    const open = positions.filter((p) => p.status === "open");
    const needsAction = open.filter((p) => {
      const pr = priceFor(p.symbol);
      return Number.isFinite(pr) && !positionAdvice(p, pr).startsWith("Hold");
    });
    const heat = acct > 0 ? stats.openRisk / acct : 0;

    const tile = (icon: string, k: string, v: string, cls = "", title = "") =>
      `<div class="mc-tile ${cls}" ${title ? `title="${escapeHtml(title)}"` : ""}>
        <span class="mc-icon">${icon}</span>
        <span class="mc-v">${v}</span><span class="mc-k">${k}</span></div>`;

    els.missionControl.innerHTML =
      `<div class="mc-tile mc-regime" title="${escapeHtml(regime.detail)}">${regimeChipHtml(regime)}</div>` +
      tile("📊", "breadth in uptrend", Number.isFinite(breadth) ? `${(breadth * 100).toFixed(0)}%` : "—", Number.isFinite(breadth) && breadth >= 0.5 ? "good" : "meh", "Share of scanned names passing the trend gate — the market's participation under the hood") +
      tile("🎯", "setups ready", results.length ? `${ready.length}${ready.length ? ` · ${ready.slice(0, 2).map((r) => r.ticker).join(" ")}` : ""}` : "—", ready.length ? "good" : "", "Names with an actionable BUY verdict right now") +
      tile("📌", "positions need action", open.length ? `${needsAction.length}/${open.length}` : "0", needsAction.length ? "hot" : "", needsAction.length ? needsAction.map((p) => p.symbol).join(", ") : "All open positions are holds") +
      tile("🔥", "portfolio heat", `${(heat * 100).toFixed(1)}%`, heat > 0.06 ? "hot" : heat > 0.04 ? "meh" : "good", "Total account % at risk if every open stop hits — cap 6%") +
      tile("⚖", "expectancy", stats.closed ? fmtR(stats.expectancyR) : "—", stats.closed && stats.expectancyR > 0 ? "good" : stats.closed ? "hot" : "", "Average realized R per closed trade — the edge, measured");
  }

  /** Download the whole journal as CSV. */
  function exportJournalCsv(): void {
    const positions = loadPositions();
    if (positions.length === 0) return;
    const header = ["Symbol", "Side", "Opened", "Status", "Entry", "Stop", "T1", "T2", "Shares", "Exit", "R", "Outcome"];
    const body = positions.map((p) => {
      const r = realizedR(p);
      return [
        p.symbol, sideOf(p), new Date(p.openedAt).toISOString().slice(0, 10), p.status,
        p.entry, p.stop, p.t1, p.t2, p.shares,
        p.exitPrice ?? "", r !== null && Number.isFinite(r) ? r.toFixed(2) : "",
        p.status === "closed" ? (r !== null && r > 0.05 ? "win" : r !== null && r < -0.05 ? "loss" : "scratch") : "",
      ];
    });
    const csv = [header, ...body].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "volumeshelfs-journal.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // One delegated listener for close/remove clicks across every re-render.
  els.positionsBody.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const closeId = t.closest<HTMLElement>("[data-close]")?.dataset.close;
    const delId = t.closest<HTMLElement>("[data-del]")?.dataset.del;
    if (closeId) {
      const p = loadPositions().find((x) => x.id === closeId);
      if (!p) return;
      const dflt = priceFor(p.symbol);
      const raw = window.prompt(`Close ${p.symbol} — exit price:`, Number.isFinite(dflt) ? dflt.toFixed(2) : "");
      const exit = Number(raw);
      if (raw === null || !Number.isFinite(exit) || exit <= 0) return;
      updatePosition(closePosition(p, exit, Date.now()));
      renderPositions();
      setStatus(`${p.symbol} closed at ${formatPrice(exit)}.`, "ok");
    } else if (delId) {
      removePosition(delId);
      renderPositions();
    }
  });
  els.posExport.addEventListener("click", exportJournalCsv);
  renderPositions(); // restore the journal from a previous session

  // ---- detail ------------------------------------------------------------
  /** Anchor override for the currently open detail (the "try the other anchor" toggle). */
  let detailOverride: ChosenAnchor | null = null;

  function select(ticker: string): void {
    // A click can arrive from a stale monitor/digest row after a rescan —
    // ignore tickers that are no longer in the results.
    if (!results.some((x) => x.ticker === ticker)) return;
    if (ticker !== selected) detailOverride = null; // reset only on a real switch
    selected = ticker;
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

    // Compute the call + plan once for the whole detail render. The override
    // path builds a fresh ScanResult, so derive from `r` directly (not the cache).
    const plan = buildTradePlan(r);
    const reco = recommend(recoContextFromScan(r), plan);
    const detailCandles = lastInputs.find((i) => i.ticker === r.ticker)?.candles ?? [];
    const shan = detailCandles.length ? shannonRead(detailCandles) : null;

    // Direction: mirror to the short side when the name is in a confirmed
    // downtrend (stage 4, or trend gate failed with the weekly pointing down).
    const bearish = shan?.stage?.stage === 4 || (!r.gates.trend.pass && shan?.mtf.weekly === "down");
    const side: "long" | "short" = bearish ? "short" : "long";
    const activePlan = side === "short" ? buildShortPlan(r) : plan;

    // THE decision: setup + stage + timeframes + confluence + discipline guard.
    const acct = Number(localStorage.getItem("vs.acct")) || 10000;
    const riskFrac = (Number(localStorage.getItem("vs.riskpref")) || 1) / 100;
    const tape = tapeOf(r.ticker);
    const disc = checkDiscipline({
      accountSize: acct,
      tradeRiskFrac: riskFrac,
      symbol: r.ticker,
      side,
      rMultipleT1: activePlan?.rMultipleT1 ?? null,
      positions: loadPositions(),
      regime,
      tape: tape ? { level: tape.level, character: tape.character } : undefined,
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

    els.detailPanels.innerHTML =
      finalCallPanelHtml(fc) +
      recoPanelHtml(reco) +
      coachPanelHtml(nextSteps(reco, plan, r.price)) +
      alertSetterHtml(r.ticker, r.price) +
      anomalyPanelHtml(tape) +
      institutionalPanelHtml(instOf(r.ticker)) +
      earlyPanelHtml(
        earlyOf(r.ticker),
        detailCandles.length >= 320 ? earlySignal(resampleWeekly(detailCandles)) : null,
      ) +
      proofPanelHtml(proofOf(r.ticker)) +
      disciplinePanelHtml(disc) +
      confluencePanelHtml(r.confluence) +
      mainPlayPanel(r) +
      thesisPanelHtml(buildThesis(r)) +
      anchorPanel(r) +
      (shan ? shannonPanelHtml(shan, r.price) : "") +
      avwapPanel(r) +
      confirmationPanelHtml(r.confirmation) +
      gatesPanel(r) +
      tradePlanPanelHtml(activePlan) +
      checklistPanel(r);

    // A fresh GO deserves a party (once per ticker per session).
    if ((fc.call === "GO" || fc.call === "GO-HALF") && !celebrated.has(r.ticker)) {
      celebrated.add(r.ticker);
      celebrate(`${r.ticker} is a ${fc.call}${side === "short" ? " · SHORT" : ""} — follow the plan! 🚀`);
    }

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
    wirePositionSizer(els.detailPanels, activePlan);
    wireTrackButton(
      els.detailPanels,
      r.ticker,
      activePlan,
      () => {
        renderPositions();
        setStatus(`${r.ticker} ${side === "short" ? "short " : ""}tracked — it now shows under Positions with live P&L in R.`, "ok");
      },
      // Snapshot the signal state at entry — the edge breakdown learns from it.
      {
        call: fc.call,
        verdict: reco.verdict,
        early: earlyOf(r.ticker)?.grade,
        inst: instOf(r.ticker)?.rating,
        tape: tape?.character,
        regime: regime.light,
        side,
      },
    );
    wireAlertSetter(els.detailPanels, r.ticker, r.price);
    updateFlowStrip();
  }

  /** Small "alert me at $X" setter — fires during monitor passes, one-shot. */
  function alertSetterHtml(ticker: string, price: number): string {
    return `<div class="panel alert-panel"><h2>🔔 Price alert</h2>
      <div class="al-row">
        <label>Alert ${ticker} at $ <input class="al-price" type="number" step="0.01" min="0" value="${price.toFixed(2)}" /></label>
        <button class="al-set ghost" type="button">Set alert</button>
        <span class="muted al-hint">one-shot · checked on every monitor pass · direction auto (above/below now)</span>
      </div></div>`;
  }

  function wireAlertSetter(container: HTMLElement, ticker: string, current: number): void {
    const btn = container.querySelector<HTMLButtonElement>(".al-set");
    const input = container.querySelector<HTMLInputElement>(".al-price");
    if (!btn || !input) return;
    btn.addEventListener("click", () => {
      const target = Number(input.value);
      if (!Number.isFinite(target) || target <= 0) return;
      const alerts = loadAlerts();
      alerts.push({
        id: `${ticker}-${Date.now()}`,
        symbol: ticker,
        price: target,
        dir: target >= current ? "above" : "below",
      });
      saveAlerts(alerts);
      btn.textContent = "✓ Set";
      btn.disabled = true;
      setStatus(`Alert set: ${ticker} ${target >= current ? "≥" : "≤"} ${target.toFixed(2)} — the monitor will catch it.`, "ok");
    });
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
      viewActive = true;
      if (results.length === 0) void run();
      else chart?.resize();
      syncMonitorVisibility();
      scheduleMonitor(); // resume auto-refresh if it was left on
      scheduleRescan();
    },
    deactivate() {
      viewActive = false; // also breaks any in-flight monitor pass
      stopMonitorTimer(); // don't keep polling the API while the tab is hidden
      stopRescanTimer();
    },
  };
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
function fmtPct(v: number): string {
  return Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%` : "—";
}
/** A signed distance-to-level, rendered with a direction arrow (↑ above, ↓ below). */
function monArrow(frac: number): string {
  if (!Number.isFinite(frac)) return "—";
  const arrow = frac > 0 ? "↑" : frac < 0 ? "↓" : "·";
  return `${(Math.abs(frac) * 100).toFixed(1)}% ${arrow}`;
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
