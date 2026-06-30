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
}

export interface LevelOverlay {
  label: string;
  price: number;
  color: string;
  dashed?: boolean;
}

export interface ChartOverlays {
  /** Line overlays plotted against the candle index (AVWAPs, MAs). */
  series?: SeriesOverlay[];
  /** Horizontal price levels (entry, stop, targets). */
  levels?: LevelOverlay[];
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
}

const MARGIN = { top: 14, right: 64, bottom: 24, left: 8 };
const PROFILE_MAX_FRAC = 0.42;

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
    canvas.addEventListener("click", this.handleClick);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement ?? canvas);
  }

  setModel(model: ChartModel): void {
    this.model = model;
    this.render();
  }

  destroy(): void {
    this.canvas.removeEventListener("mousemove", this.handleMove);
    this.canvas.removeEventListener("mouseleave", this.handleLeave);
    this.canvas.removeEventListener("click", this.handleClick);
    this.ro?.disconnect();
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
    let low = Infinity;
    let high = -Infinity;
    for (const c of candles) {
      if (c.low < low) low = c.low;
      if (c.high > high) high = c.high;
    }
    if (!Number.isFinite(low) || !Number.isFinite(high)) {
      low = 0;
      high = 1;
    }
    const pad = (high - low) * 0.04 || 1;
    const scale = this.model?.profile?.scale ?? "log";
    this.priceAxis = new PriceAxis(Math.max(low - pad, low * 0.98), high + pad, scale, this.plot);
    this.indexAxis = new IndexAxis(candles.length, this.plot);
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
    this.drawAxes();
    this.drawCrosshair();
    ctx.restore();
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
    const { ctx, priceAxis, indexAxis, theme } = this;
    const candles = this.model!.candles;
    if (!priceAxis || !indexAxis) return;
    const bw = indexAxis.bodyWidth;
    for (let i = 0; i < candles.length; i++) {
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

    for (const s of overlays.series ?? []) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash(s.dashed ? [4, 3] : []);
      ctx.beginPath();
      let started = false;
      let lastX = 0;
      let lastY = 0;
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
      if (started) {
        ctx.font = "10px system-ui, sans-serif";
        ctx.fillStyle = s.color;
        ctx.textAlign = "right";
        ctx.textBaseline = "bottom";
        ctx.fillText(s.label, Math.min(lastX, plot.x + plot.width) - 2, lastY - 2);
      }
    }

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
    // time axis: a handful of evenly spaced dates
    const candles = this.model!.candles;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const ticks = 6;
    for (let i = 0; i <= ticks; i++) {
      const idx = Math.min(candles.length - 1, Math.round((i / ticks) * (candles.length - 1)));
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

  private handleMove = (e: MouseEvent): void => {
    this.hover = this.pointerPos(e);
    this.render();
  };

  private handleLeave = (): void => {
    this.hover = null;
    this.render();
  };

  private handleClick = (e: MouseEvent): void => {
    if (!this.indexAxis || !this.model) return;
    const { x, y } = this.pointerPos(e);
    if (x < this.plot.x || x > this.plot.x + this.plot.width) return;
    if (y < this.plot.y || y > this.plot.y + this.plot.height) return;
    const idx = this.indexAxis.index(x);
    this.onAnchorChange?.(idx);
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
