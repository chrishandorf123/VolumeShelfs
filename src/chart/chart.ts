import type { AnchoredVolumeProfile, Candle } from "../core/types";
import type { ProfileAnalysis } from "../core/shelves";
import {
  IndexAxis,
  PriceAxis,
  type Rect,
  formatDate,
  formatPrice,
  formatVolume,
} from "./scale";
import { DARK_THEME, type ChartTheme } from "./theme";

export interface SeriesOverlay {
  label: string;
  /** Per-candle values (NaN where undefined); same length as candles. */
  values: number[];
  color: string;
  dashed?: boolean;
  /** "dots" renders disconnected points (a trailing-stop trail) instead of a line. */
  style?: "line" | "dots";
  /** Skip the inline label at the last point (dot trails label themselves). */
  noLabel?: boolean;
}

export interface LevelOverlay {
  label: string;
  price: number;
  color: string;
  dashed?: boolean;
}

/** A per-bar event tag (signal entry/exit) anchored to a candle. */
export interface MarkerOverlay {
  index: number;
  price: number;
  text: string;
  color: string;
  /** Place the tag above or below the bar. */
  position: "above" | "below";
  /** Emphasized = filled tag with a pointer (entries); plain text otherwise. */
  emphasis?: boolean;
}

export interface ChartOverlays {
  /** Line overlays plotted against the candle index (AVWAPs, MAs). */
  series?: SeriesOverlay[];
  /** Horizontal price levels (entry, stop, targets). */
  levels?: LevelOverlay[];
  /** Signal tags anchored to individual bars. */
  markers?: MarkerOverlay[];
}

/** A suggested anchor pivot the coach marks on the chart (click to anchor). */
export interface AnchorMarker {
  index: number;
  price: number;
  kind: "low" | "high";
  recommended: boolean;
}

export interface ChartModel {
  candles: Candle[];
  profile: AnchoredVolumeProfile | null;
  analysis: ProfileAnalysis | null;
  anchorIndex: number;
  currentPrice: number;
  show: {
    profile: boolean;
    shelves: boolean;
    gaps: boolean;
    valueArea: boolean;
  };
  overlays?: ChartOverlays;
  /** Suggested anchor pivots (swing low/high) the coach marks. */
  suggestions?: AnchorMarker[];
  /** Stretch the price axis to the WHOLE profile (full-history mode) so
   *  shelves far above/below the visible candles stay on screen. */
  fitProfileRange?: boolean;
  /** No profile gutter — candles span the full plot (profile-less views). */
  fullWidthCandles?: boolean;
}

const MARGIN = { top: 14, right: 64, bottom: 24, left: 8 };
/** Fraction of the plot reserved on the right for the volume-profile gutter. */
const PROFILE_GUTTER_FRAC = 0.26;
/** Extra whitespace between the newest candle and the profile ("a few months"). */
const FUTURE_PAD_FRAC = 0.06;
/** Max width of a profile bar within the gutter. */
const PROFILE_MAX_FRAC = 0.24;

/**
 * Canvas renderer for the anchored volume profile. Owns its own pointer
 * interactions: click to re-anchor, hover for a crosshair + tooltip.
 */
export class VolumeShelfsChart {
  private readonly ctx: CanvasRenderingContext2D;
  private model: ChartModel | null = null;
  private plot: Rect = { x: 0, y: 0, width: 0, height: 0 };
  private priceAxis: PriceAxis | null = null;
  private indexAxis: IndexAxis | null = null;
  private hover: { x: number; y: number } | null = null;
  private dpr = 1;
  private ro: ResizeObserver | null = null;
  /** Visible candle range; null = fit all. Set by zoom/pan. */
  private view: { start: number; end: number } | null = null;
  /** Resolved visible range for the current render (set in layout). */
  private visible = { start: 0, end: 0 };
  /** True after a wheel zoom — full-range fitting yields to the user's zoom. */
  private userZoomed = false;
  private lastCount = -1;
  private drag: { x: number; startView: { start: number; end: number }; moved: boolean } | null = null;

  /** Fired when the user clicks a candle to set a new anchor. */
  onAnchorChange: ((index: number) => void) | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly theme: ChartTheme = DARK_THEME,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    canvas.addEventListener("mousemove", this.handleMove);
    canvas.addEventListener("mouseleave", this.handleLeave);
    canvas.addEventListener("mousedown", this.handleDown);
    canvas.addEventListener("mouseup", this.handleUp);
    canvas.addEventListener("dblclick", this.handleDblClick);
    canvas.addEventListener("wheel", this.handleWheel, { passive: false });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement ?? canvas);
  }

  setModel(model: ChartModel): void {
    // Reset the viewport when a different series is loaded (fit to all).
    if (model.candles.length !== this.lastCount) {
      this.view = null;
      this.lastCount = model.candles.length;
    }
    this.model = model;
    this.render();
  }

  destroy(): void {
    this.canvas.removeEventListener("mousemove", this.handleMove);
    this.canvas.removeEventListener("mouseleave", this.handleLeave);
    this.canvas.removeEventListener("mousedown", this.handleDown);
    this.canvas.removeEventListener("mouseup", this.handleUp);
    this.canvas.removeEventListener("dblclick", this.handleDblClick);
    this.canvas.removeEventListener("wheel", this.handleWheel);
    this.ro?.disconnect();
  }

  /**
   * Set the visible window to the last `count` candles (a timeframe button).
   * Pass null (or a count >= total) to fit all. Persists across re-renders of
   * the same series so option tweaks don't reset the user's timeframe.
   */
  setVisibleCount(count: number | null): void {
    const n = this.model?.candles.length ?? 0;
    if (n === 0) return;
    if (count === null || count >= n) {
      this.view = null;
    } else {
      const c = Math.min(Math.max(count, 10), n);
      this.view = { start: n - c, end: n - 1 };
    }
    this.userZoomed = false; // timeframe buttons restore full-map fitting
    this.render();
  }

  /** Number of candles currently visible. */
  get visibleCount(): number {
    const n = this.model?.candles.length ?? 0;
    return this.view ? this.view.end - this.view.start + 1 : n;
  }

  resize(): void {
    const parent = this.canvas.parentElement;
    const w = parent?.clientWidth ?? this.canvas.clientWidth;
    const h = parent?.clientHeight ?? this.canvas.clientHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.render();
  }

  // ---- geometry -----------------------------------------------------------

  private layout(w: number, h: number): void {
    this.plot = {
      x: MARGIN.left,
      y: MARGIN.top,
      width: Math.max(10, w - MARGIN.left - MARGIN.right),
      height: Math.max(10, h - MARGIN.top - MARGIN.bottom),
    };
    const candles = this.model?.candles ?? [];
    const n = candles.length;
    // Resolve the visible range from the viewport (default: fit all).
    const start = Math.min(Math.max(this.view?.start ?? 0, 0), Math.max(0, n - 1));
    const end = Math.min(Math.max(this.view?.end ?? n - 1, start), Math.max(0, n - 1));
    this.visible = { start, end };
    const visibleCount = Math.max(1, end - start + 1);

    // Fit the price axis to the *visible* candles so zooming re-scales price.
    let low = Infinity;
    let high = -Infinity;
    for (let i = start; i <= end; i++) {
      if (candles[i].low < low) low = candles[i].low;
      if (candles[i].high > high) high = candles[i].high;
    }
    if (!Number.isFinite(low) || !Number.isFinite(high)) {
      low = 0;
      high = 1;
    }
    // Widen the domain so the structure the analysis talks about stays ON the
    // chart: trade levels (entry/stop/T1/T2), overhead volume gaps and supply
    // shelves above price, demand underneath. Capped so one far-away extreme
    // can't crush the candles into a sliver.
    const candleHigh = high;
    const candleLow = low;
    const capHigh = candleHigh * 1.45;
    const capLow = candleLow * 0.7;
    const include = (p: number | undefined | null): void => {
      if (p === undefined || p === null || !Number.isFinite(p)) return;
      if (p > high && p <= capHigh) high = p;
      if (p < low && p >= capLow) low = p;
    };
    for (const lv of this.model?.overlays?.levels ?? []) include(lv.price);
    const az = this.model?.analysis;
    if (az) {
      for (const g of az.gaps) {
        include(g.priceLow);
        include(g.priceHigh);
      }
      for (const s of az.shelves) {
        include(s.priceLow);
        include(s.priceHigh);
      }
      include(az.nearestSupply?.priceHigh);
      include(az.nearestDemand?.priceLow);
    }
    // Full-history mode: the whole profile IS the map — no caps. Shelves where
    // price traded at 25 must stay visible even when today's candles sit at 13.
    // Skipped while the user is wheel-zoomed (zoom must still rescale price)
    // and when none of the profile geometry is toggled visible.
    const bins = this.model?.profile?.bins;
    const showAny = this.model ? this.model.show.profile || this.model.show.shelves || this.model.show.gaps : false;
    if (this.model?.fitProfileRange && !this.userZoomed && showAny && bins && bins.length > 0) {
      // A single bad low<=0 bar must not silently flip a log axis to linear.
      const extLow = this.model.profile?.scale === "log" ? Math.max(bins[0].low, 1e-6) : bins[0].low;
      low = Math.min(low, extLow);
      high = Math.max(high, bins[bins.length - 1].high);
    }
    const pad = (high - low) * 0.04 || 1;
    const scale = this.model?.profile?.scale ?? "log";
    this.priceAxis = new PriceAxis(Math.max(low - pad, low * 0.98), high + pad, scale, this.plot);
    // Candles occupy the left of the plot; the right is a gutter for the volume
    // profile plus a little future whitespace, so the newest bars are never
    // hidden behind the profile and you can see where price sits in the gaps.
    // Profile-less views reclaim the gutter (keep a sliver of breathing room).
    const gutter = this.model?.fullWidthCandles ? 0.02 : PROFILE_GUTTER_FRAC + FUTURE_PAD_FRAC;
    const candleAreaWidth = this.plot.width * (1 - gutter);
    this.indexAxis = new IndexAxis(start, visibleCount, this.plot.x, candleAreaWidth);
  }

  // ---- rendering ----------------------------------------------------------

  render(): void {
    const { ctx } = this;
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = this.theme.background;
    ctx.fillRect(0, 0, w, h);

    if (!this.model || this.model.candles.length === 0) {
      ctx.fillStyle = this.theme.axisText;
      ctx.font = "13px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Load a symbol to begin", w / 2, h / 2);
      ctx.restore();
      return;
    }

    this.layout(w, h);
    this.drawGrid();
    if (this.model.show.shelves) this.drawShelfBands();
    if (this.model.show.gaps) this.drawGapBands();
    this.drawCandles();
    if (this.model.show.profile) this.drawProfile();
    if (this.model.show.valueArea) this.drawValueArea();
    this.drawOverlays();
    this.drawPocAndPrice();
    this.drawAnchor();
    this.drawSuggestions();
    this.drawAxes();
    this.drawCrosshair();
    ctx.restore();
  }

  private drawSuggestions(): void {
    const marks = this.model!.suggestions;
    if (!marks || !this.priceAxis || !this.indexAxis) return;
    const { ctx, priceAxis, indexAxis, plot, theme, visible } = this;
    for (const m of marks) {
      if (m.index < visible.start || m.index > visible.end) continue;
      const x = indexAxis.x(m.index);
      const isLow = m.kind === "low";
      const color = isLow ? theme.demandLine : theme.supplyLine;
      const alpha = m.recommended ? 1 : 0.5;
      const yBase = priceAxis.y(m.price);
      // Flag sits just outside the candle: below a low, above a high.
      const y = isLow ? Math.min(yBase + 16, plot.y + plot.height - 4) : Math.max(yBase - 16, plot.y + 10);
      ctx.save();
      ctx.globalAlpha = alpha;
      // marker triangle pointing at the pivot
      ctx.fillStyle = color;
      ctx.beginPath();
      if (isLow) {
        ctx.moveTo(x, y - 7);
        ctx.lineTo(x - 5, y);
        ctx.lineTo(x + 5, y);
      } else {
        ctx.moveTo(x, y + 7);
        ctx.lineTo(x - 5, y);
        ctx.lineTo(x + 5, y);
      }
      ctx.closePath();
      ctx.fill();
      // label
      const text = `${m.recommended ? "★ " : ""}anchor: swing ${m.kind}`;
      ctx.font = `${m.recommended ? "bold " : ""}10px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = isLow ? "top" : "bottom";
      const ty = isLow ? y + 3 : y - 3;
      const w = ctx.measureText(text).width + 8;
      ctx.globalAlpha = alpha * 0.85;
      ctx.fillStyle = theme.background;
      ctx.fillRect(x - w / 2, isLow ? ty : ty - 13, w, 13);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.fillText(text, x, isLow ? ty + 1 : ty - 1);
      ctx.restore();
    }
  }

  private drawGrid(): void {
    const { ctx, priceAxis, plot, theme } = this;
    if (!priceAxis) return;
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const p of priceAxis.ticks(6)) {
      const y = Math.round(priceAxis.y(p)) + 0.5;
      ctx.moveTo(plot.x, y);
      ctx.lineTo(plot.x + plot.width, y);
    }
    ctx.stroke();
  }

  private drawCandles(): void {
    const { ctx, priceAxis, indexAxis, theme, visible } = this;
    const candles = this.model!.candles;
    if (!priceAxis || !indexAxis) return;
    const bw = indexAxis.bodyWidth;
    for (let i = visible.start; i <= visible.end; i++) {
      const c = candles[i];
      const x = indexAxis.x(i);
      const up = c.close >= c.open;
      const color = up ? theme.upCandle : theme.downCandle;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      // wick
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, priceAxis.y(c.high));
      ctx.lineTo(Math.round(x) + 0.5, priceAxis.y(c.low));
      ctx.stroke();
      // body
      const yOpen = priceAxis.y(c.open);
      const yClose = priceAxis.y(c.close);
      const top = Math.min(yOpen, yClose);
      const bodyH = Math.max(1, Math.abs(yClose - yOpen));
      ctx.fillRect(x - bw / 2, top, bw, bodyH);
    }
  }

  private drawProfile(): void {
    const { ctx, priceAxis, plot, theme } = this;
    const profile = this.model!.profile;
    if (!profile || !priceAxis) return;
    const maxVol = profile.poc.volume || 1;
    const maxWidth = plot.width * PROFILE_MAX_FRAC;
    const right = plot.x + plot.width;
    const roles = this.binRoles();

    ctx.save();
    ctx.beginPath();
    ctx.rect(plot.x, plot.y, plot.width, plot.height);
    ctx.clip();
    for (let i = 0; i < profile.bins.length; i++) {
      const bin = profile.bins[i];
      if (bin.volume <= 0) continue;
      const bw = (bin.volume / maxVol) * maxWidth;
      const yTop = priceAxis.y(bin.high);
      const yBot = priceAxis.y(bin.low);
      const hgt = Math.max(1, yBot - yTop);
      ctx.fillStyle = i === profile.pocIndex ? theme.profileBarPoc : roles[i];
      ctx.fillRect(right - bw, yTop + 0.5, bw, Math.max(1, hgt - 1));
    }
    ctx.restore();
  }

  /** Per-bin fill colour for the profile bars based on shelf/gap membership. */
  private binRoles(): string[] {
    const profile = this.model!.profile!;
    const analysis = this.model!.analysis;
    const roles = new Array<string>(profile.bins.length).fill(this.theme.profileBar);
    if (!analysis) return roles;
    for (const shelf of analysis.shelves) {
      const color =
        shelf.zone === "break-even-demand"
          ? this.theme.demandLine
          : shelf.zone === "break-even-supply"
            ? this.theme.supplyLine
            : this.theme.neutralLine;
      for (let i = shelf.lowIndex; i <= shelf.highIndex; i++) roles[i] = fade(color, 0.4);
    }
    return roles;
  }

  private drawShelfBands(): void {
    const analysis = this.model!.analysis;
    if (!analysis) return;
    for (const shelf of analysis.shelves) {
      const { fill, line, label } =
        shelf.zone === "break-even-demand"
          ? { fill: this.theme.demandFill, line: this.theme.demandLine, label: "Break-even demand" }
          : shelf.zone === "break-even-supply"
            ? { fill: this.theme.supplyFill, line: this.theme.supplyLine, label: "Break-even supply" }
            : { fill: this.theme.neutralFill, line: this.theme.neutralLine, label: "Volume shelf" };
      this.drawBand(shelf.priceLow, shelf.priceHigh, fill, line, false);
      this.bandLabel(shelf.priceHigh, `${label} · ${(shelf.fraction * 100).toFixed(1)}%`, line);
    }
  }

  private drawGapBands(): void {
    const analysis = this.model!.analysis;
    if (!analysis) return;
    for (const gap of analysis.gaps) {
      this.drawBand(gap.priceLow, gap.priceHigh, this.theme.gapFill, this.theme.gapLine, true);
      this.bandLabel(gap.priceHigh, "Volume gap", this.theme.gapLine);
    }
  }

  private drawBand(
    priceLow: number,
    priceHigh: number,
    fill: string,
    line: string,
    dashed: boolean,
  ): void {
    const { ctx, priceAxis, plot } = this;
    if (!priceAxis) return;
    const yTop = priceAxis.y(priceHigh);
    const yBot = priceAxis.y(priceLow);
    ctx.save();
    ctx.beginPath();
    ctx.rect(plot.x, plot.y, plot.width, plot.height);
    ctx.clip();
    ctx.fillStyle = fill;
    ctx.fillRect(plot.x, yTop, plot.width, yBot - yTop);
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.setLineDash(dashed ? [4, 3] : []);
    ctx.beginPath();
    ctx.moveTo(plot.x, Math.round(yTop) + 0.5);
    ctx.lineTo(plot.x + plot.width, Math.round(yTop) + 0.5);
    ctx.moveTo(plot.x, Math.round(yBot) + 0.5);
    ctx.lineTo(plot.x + plot.width, Math.round(yBot) + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  private bandLabel(priceHigh: number, text: string, color: string): void {
    const { ctx, priceAxis, plot } = this;
    if (!priceAxis) return;
    const y = priceAxis.y(priceHigh);
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = color;
    ctx.fillText(text, plot.x + 6, y - 2);
  }

  private drawValueArea(): void {
    const { ctx, priceAxis, plot, theme } = this;
    const profile = this.model!.profile;
    if (!profile || !priceAxis) return;
    ctx.strokeStyle = theme.valueArea;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    for (const price of [profile.valueArea.low, profile.valueArea.high]) {
      const y = Math.round(priceAxis.y(price)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(plot.x, y);
      ctx.lineTo(plot.x + plot.width, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  private drawOverlays(): void {
    const overlays = this.model!.overlays;
    if (!overlays) return;
    const { ctx, priceAxis, indexAxis, plot } = this;
    if (!priceAxis || !indexAxis) return;

    // Clip line overlays to the plot so they don't spill over the axes when
    // the chart is zoomed/panned.
    ctx.save();
    ctx.beginPath();
    ctx.rect(plot.x, plot.y, plot.width, plot.height);
    ctx.clip();
    for (const s of overlays.series ?? []) {
      let started = false;
      let lastX = 0;
      let lastY = 0;
      if (s.style === "dots") {
        ctx.fillStyle = s.color;
        for (let i = 0; i < s.values.length; i++) {
          const v = s.values[i];
          if (!Number.isFinite(v)) continue;
          const x = indexAxis.x(i);
          const y = priceAxis.y(v);
          ctx.beginPath();
          ctx.arc(x, y, 2, 0, Math.PI * 2);
          ctx.fill();
          started = true;
          lastX = x;
          lastY = y;
        }
      } else {
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash(s.dashed ? [4, 3] : []);
        ctx.beginPath();
        for (let i = 0; i < s.values.length; i++) {
          const v = s.values[i];
          if (!Number.isFinite(v)) {
            started = false;
            continue;
          }
          const x = indexAxis.x(i);
          const y = priceAxis.y(v);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
          lastX = x;
          lastY = y;
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (started && !s.noLabel) {
        ctx.font = "10px system-ui, sans-serif";
        ctx.fillStyle = s.color;
        ctx.textAlign = "right";
        ctx.textBaseline = "bottom";
        ctx.fillText(s.label, Math.min(lastX, plot.x + plot.width) - 2, lastY - 2);
      }
    }
    ctx.restore();

    this.drawMarkers(overlays.markers ?? []);

    for (const lvl of overlays.levels ?? []) {
      const y = Math.round(priceAxis.y(lvl.price)) + 0.5;
      ctx.strokeStyle = lvl.color;
      ctx.lineWidth = 1;
      ctx.setLineDash(lvl.dashed ? [6, 4] : []);
      ctx.beginPath();
      ctx.moveTo(plot.x, y);
      ctx.lineTo(plot.x + plot.width, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "10px system-ui, sans-serif";
      ctx.fillStyle = lvl.color;
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(lvl.label, plot.x + 6, y - 2);
    }
  }

  /** Signal tags (entries/exits) anchored to bars, drawSuggestions-style. */
  private drawMarkers(markers: MarkerOverlay[]): void {
    if (!markers.length || !this.priceAxis || !this.indexAxis) return;
    const { ctx, priceAxis, indexAxis, plot, visible } = this;
    for (const m of markers) {
      if (m.index < visible.start || m.index > visible.end) continue;
      const x = indexAxis.x(m.index);
      const below = m.position === "below";
      const yBase = priceAxis.y(m.price);
      const y = below ? Math.min(yBase + 14, plot.y + plot.height - 4) : Math.max(yBase - 14, plot.y + 10);
      ctx.save();
      ctx.font = `${m.emphasis ? "bold " : ""}10px system-ui, sans-serif`;
      const w = ctx.measureText(m.text).width + 10;
      if (m.emphasis) {
        // pointer triangle toward the bar
        ctx.fillStyle = m.color;
        ctx.beginPath();
        if (below) {
          ctx.moveTo(x, y - 6);
          ctx.lineTo(x - 4, y + 1);
          ctx.lineTo(x + 4, y + 1);
        } else {
          ctx.moveTo(x, y + 6);
          ctx.lineTo(x - 4, y - 1);
          ctx.lineTo(x + 4, y - 1);
        }
        ctx.closePath();
        ctx.fill();
        roundRect(ctx, x - w / 2, below ? y + 1 : y - 15, w, 14, 3);
        ctx.fill();
        ctx.fillStyle = this.theme.background;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(m.text, x, (below ? y + 8 : y - 8) + 1);
      } else {
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = this.theme.background;
        ctx.fillRect(x - w / 2, below ? y : y - 13, w, 13);
        ctx.globalAlpha = 1;
        ctx.fillStyle = m.color;
        ctx.textAlign = "center";
        ctx.textBaseline = below ? "top" : "bottom";
        ctx.fillText(m.text, x, below ? y + 1 : y - 1);
      }
      ctx.restore();
    }
  }

  private drawPocAndPrice(): void {
    const { ctx, priceAxis, plot, theme } = this;
    const profile = this.model!.profile;
    if (!priceAxis) return;
    if (profile) {
      const y = Math.round(priceAxis.y(profile.poc.mid)) + 0.5;
      ctx.strokeStyle = theme.poc;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(plot.x, y);
      ctx.lineTo(plot.x + plot.width, y);
      ctx.stroke();
      this.tag(plot.x + plot.width, y, "POC", theme.poc, "#0e1117");
    }
    const price = this.model!.currentPrice;
    const yp = Math.round(priceAxis.y(price)) + 0.5;
    ctx.strokeStyle = theme.currentPrice;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(plot.x, yp);
    ctx.lineTo(plot.x + plot.width, yp);
    ctx.stroke();
    ctx.setLineDash([]);
    this.tag(plot.x + plot.width, yp, formatPrice(price), theme.currentPrice, "#0e1117");
  }

  private drawAnchor(): void {
    const { ctx, indexAxis, plot, theme } = this;
    if (!indexAxis) return;
    if (this.model!.anchorIndex < 0) return; // anchor-less view (Trail tab)
    const x = Math.round(indexAxis.x(this.model!.anchorIndex)) + 0.5;
    ctx.strokeStyle = theme.anchor;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, plot.y);
    ctx.lineTo(x, plot.y + plot.height);
    ctx.stroke();
    ctx.setLineDash([]);
    // anchor flag
    ctx.fillStyle = theme.anchor;
    ctx.beginPath();
    ctx.moveTo(x, plot.y);
    ctx.lineTo(x + 9, plot.y + 5);
    ctx.lineTo(x, plot.y + 10);
    ctx.closePath();
    ctx.fill();
  }

  private drawAxes(): void {
    const { ctx, priceAxis, indexAxis, plot, theme } = this;
    if (!priceAxis || !indexAxis) return;
    ctx.fillStyle = theme.axisText;
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (const p of priceAxis.ticks(6)) {
      ctx.fillText(formatPrice(p), plot.x + plot.width + 6, priceAxis.y(p));
    }
    // time axis: a handful of evenly spaced dates across the visible range
    const candles = this.model!.candles;
    const { start, end } = this.visible;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const ticks = 6;
    for (let i = 0; i <= ticks; i++) {
      const idx = Math.min(end, start + Math.round((i / ticks) * (end - start)));
      ctx.fillText(formatDate(candles[idx].time), indexAxis.x(idx), plot.y + plot.height + 6);
    }
  }

  private drawCrosshair(): void {
    if (!this.hover) return;
    const { ctx, priceAxis, indexAxis, plot, theme } = this;
    if (!priceAxis || !indexAxis) return;
    const { x, y } = this.hover;
    if (x < plot.x || x > plot.x + plot.width || y < plot.y || y > plot.y + plot.height) return;
    ctx.strokeStyle = theme.crosshair;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(plot.x, Math.round(y) + 0.5);
    ctx.lineTo(plot.x + plot.width, Math.round(y) + 0.5);
    ctx.moveTo(Math.round(x) + 0.5, plot.y);
    ctx.lineTo(Math.round(x) + 0.5, plot.y + plot.height);
    ctx.stroke();
    ctx.setLineDash([]);
    this.tag(plot.x + plot.width, y, formatPrice(priceAxis.price(y)), theme.crosshair, "#0e1117");
    this.drawTooltip(x, y);
  }

  private drawTooltip(x: number, y: number): void {
    const { ctx, indexAxis, priceAxis, plot, theme } = this;
    if (!indexAxis || !priceAxis) return;
    const i = indexAxis.index(x);
    const c = this.model!.candles[i];
    if (!c) return;
    const price = priceAxis.price(y);
    const zone = this.zoneAt(price);
    const lines = [
      formatDate(c.time),
      `O ${formatPrice(c.open)}  H ${formatPrice(c.high)}`,
      `L ${formatPrice(c.low)}  C ${formatPrice(c.close)}`,
      `Vol ${formatVolume(c.volume)}`,
    ];
    if (zone) lines.push(zone);
    ctx.font = "11px system-ui, sans-serif";
    const wBox = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
    const hBox = lines.length * 15 + 10;
    let bx = x + 14;
    let by = y + 14;
    if (bx + wBox > plot.x + plot.width) bx = x - wBox - 14;
    if (by + hBox > plot.y + plot.height) by = y - hBox - 14;
    ctx.fillStyle = theme.tooltipBg;
    ctx.strokeStyle = theme.grid;
    roundRect(ctx, bx, by, wBox, hBox, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = theme.tooltipText;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    lines.forEach((l, idx) => ctx.fillText(l, bx + 8, by + 6 + idx * 15));
  }

  private zoneAt(price: number): string | null {
    const analysis = this.model!.analysis;
    if (!analysis) return null;
    for (const shelf of analysis.shelves) {
      if (price >= shelf.priceLow && price <= shelf.priceHigh) {
        const name =
          shelf.zone === "break-even-demand"
            ? "Break-even demand (support)"
            : shelf.zone === "break-even-supply"
              ? "Break-even supply (resistance)"
              : "Volume shelf";
        return name;
      }
    }
    for (const gap of analysis.gaps) {
      if (price >= gap.priceLow && price <= gap.priceHigh) return "Volume gap (low friction)";
    }
    return null;
  }

  // ---- helpers ------------------------------------------------------------

  private tag(xRight: number, y: number, text: string, bg: string, fg: string): void {
    const { ctx } = this;
    ctx.font = "11px system-ui, sans-serif";
    const w = ctx.measureText(text).width + 8;
    ctx.fillStyle = bg;
    ctx.fillRect(xRight + 2, y - 8, w, 16);
    ctx.fillStyle = fg;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, xRight + 6, y + 1);
  }

  private pointerPos(e: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private resolvedView(): { start: number; end: number } {
    const n = this.model?.candles.length ?? 0;
    return this.view ?? { start: 0, end: Math.max(0, n - 1) };
  }

  private handleMove = (e: MouseEvent): void => {
    const pos = this.pointerPos(e);
    this.hover = pos;
    // Drag to pan the viewport.
    if (this.drag && this.indexAxis && this.model) {
      const n = this.model.candles.length;
      const dxIdx = Math.round((this.drag.x - pos.x) / this.indexAxis.step);
      if (Math.abs(pos.x - this.drag.x) > 3) this.drag.moved = true;
      const count = this.drag.startView.end - this.drag.startView.start + 1;
      let start = this.drag.startView.start + dxIdx;
      start = Math.min(Math.max(start, 0), Math.max(0, n - count));
      this.view = count >= n ? null : { start, end: start + count - 1 };
    }
    this.render();
  };

  private handleLeave = (): void => {
    this.hover = null;
    this.drag = null;
    this.render();
  };

  private handleDown = (e: MouseEvent): void => {
    const { x, y } = this.pointerPos(e);
    if (x < this.plot.x || x > this.plot.x + this.plot.width) return;
    if (y < this.plot.y || y > this.plot.y + this.plot.height) return;
    this.drag = { x, startView: this.resolvedView(), moved: false };
  };

  private handleUp = (e: MouseEvent): void => {
    const drag = this.drag;
    this.drag = null;
    if (!drag || drag.moved) return; // a pan, not a click
    // A click (no drag) sets the anchor, if the host wants it.
    if (!this.indexAxis || !this.model) return;
    const { x, y } = this.pointerPos(e);
    if (x < this.plot.x || x > this.plot.x + this.plot.width) return;
    if (y < this.plot.y || y > this.plot.y + this.plot.height) return;
    this.onAnchorChange?.(this.indexAxis.index(x));
  };

  private handleDblClick = (): void => {
    this.view = null; // reset zoom to fit-all
    this.userZoomed = false;
    this.render();
  };

  private handleWheel = (e: WheelEvent): void => {
    if (!this.model || !this.indexAxis) return;
    e.preventDefault();
    const n = this.model.candles.length;
    if (n < 2) return;
    const { x } = this.pointerPos(e);
    const cursorIdx = this.indexAxis.index(x);
    const { start, end } = this.resolvedView();
    const count = end - start + 1;
    const factor = e.deltaY > 0 ? 1.2 : 1 / 1.2; // out : in
    const minCount = Math.min(15, n);
    const newCount = Math.min(n, Math.max(minCount, Math.round(count * factor)));
    if (newCount >= n) {
      this.view = null; // fully zoomed out
      this.userZoomed = false;
      this.render();
      return;
    }
    const frac = count > 1 ? (cursorIdx - start) / (count - 1) : 0;
    let newStart = Math.round(cursorIdx - frac * (newCount - 1));
    newStart = Math.min(Math.max(newStart, 0), n - newCount);
    this.view = { start: newStart, end: newStart + newCount - 1 };
    this.userZoomed = true; // let the zoom actually rescale price in full mode
    this.render();
  };
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Apply an alpha to an `rgb`/`rgba`/hex colour string. */
function fade(color: string, alpha: number): string {
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const parts = m[1].split(",").map((s) => s.trim());
    return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
  }
  return color;
}
