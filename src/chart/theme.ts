export interface ChartTheme {
  background: string;
  grid: string;
  axisText: string;
  upCandle: string;
  downCandle: string;
  profileBar: string;
  profileBarPoc: string;
  demandFill: string;
  demandLine: string;
  supplyFill: string;
  supplyLine: string;
  neutralFill: string;
  neutralLine: string;
  gapFill: string;
  gapLine: string;
  poc: string;
  valueArea: string;
  currentPrice: string;
  anchor: string;
  crosshair: string;
  tooltipBg: string;
  tooltipText: string;
}

export const DARK_THEME: ChartTheme = {
  background: "#0e1117",
  grid: "#1b2230",
  axisText: "#8b95a7",
  upCandle: "#26a69a",
  downCandle: "#ef5350",
  profileBar: "rgba(150, 160, 180, 0.34)",
  profileBarPoc: "rgba(245, 200, 66, 0.55)",
  demandFill: "rgba(38, 166, 154, 0.12)",
  demandLine: "rgba(38, 166, 154, 0.85)",
  supplyFill: "rgba(239, 83, 80, 0.12)",
  supplyLine: "rgba(239, 83, 80, 0.85)",
  neutralFill: "rgba(150, 160, 180, 0.10)",
  neutralLine: "rgba(150, 160, 180, 0.7)",
  gapFill: "rgba(245, 200, 66, 0.08)",
  gapLine: "rgba(245, 200, 66, 0.55)",
  poc: "#f5c842",
  valueArea: "rgba(139, 149, 167, 0.8)",
  currentPrice: "#e6e9ef",
  anchor: "#5b8def",
  crosshair: "rgba(200, 208, 220, 0.55)",
  tooltipBg: "rgba(20, 26, 38, 0.95)",
  tooltipText: "#e6e9ef",
};
