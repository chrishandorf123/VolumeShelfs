/**
 * Ticker → sector map for the curated universe. Leaders cluster in leading
 * groups (O'Neil's "M" and group-strength work), and correlated positions are
 * one bet wearing three tickers — both need to know the sector. Names outside
 * the map report "Other"; crypto/FX pairs report their own class.
 */
const SECTOR_MAP: Record<string, string> = {
  // Semis
  NVDA: "Semis", AMD: "Semis", INTC: "Semis", QCOM: "Semis", TXN: "Semis",
  MU: "Semis", AMAT: "Semis", LRCX: "Semis", KLAC: "Semis", ADI: "Semis",
  AVGO: "Semis", MRVL: "Semis", ON: "Semis", MCHP: "Semis", ARM: "Semis",
  SMCI: "Semis", TSM: "Semis", SMH: "Semis", SOXX: "Semis",
  // Software / internet
  MSFT: "Software", ORCL: "Software", ADBE: "Software", CRM: "Software",
  NOW: "Software", INTU: "Software", PANW: "Software", SNPS: "Software",
  CDNS: "Software", PLTR: "Software", SHOP: "Software", SNOW: "Software",
  CRWD: "Software", DDOG: "Software", NET: "Software", MDB: "Software",
  ZS: "Software", U: "Software", RBLX: "Software",
  // Big tech / comms / media
  AAPL: "Tech hardware", DELL: "Tech hardware", HPQ: "Tech hardware",
  WDC: "Tech hardware", STX: "Tech hardware", CSCO: "Tech hardware",
  IBM: "Tech hardware", ANET: "Tech hardware",
  GOOGL: "Comms/media", META: "Comms/media",
  NFLX: "Comms/media", DIS: "Comms/media", ROKU: "Comms/media", PINS: "Comms/media",
  SNAP: "Comms/media", T: "Comms/media", VZ: "Comms/media", TMUS: "Comms/media", XLC: "Comms/media",
  // Consumer
  AMZN: "Consumer", TSLA: "Consumer", WMT: "Consumer", COST: "Consumer",
  HD: "Consumer", LOW: "Consumer", TGT: "Consumer", NKE: "Consumer",
  SBUX: "Consumer", MCD: "Consumer", CMG: "Consumer", PG: "Consumer",
  KO: "Consumer", PEP: "Consumer", PM: "Consumer", MO: "Consumer",
  LULU: "Consumer", DECK: "Consumer", ROST: "Consumer", TJX: "Consumer",
  DG: "Consumer", XLY: "Consumer", XLP: "Consumer", XRT: "Consumer",
  UBER: "Consumer", ABNB: "Consumer", DKNG: "Consumer", CVNA: "Consumer",
  CCL: "Consumer", BABA: "Consumer", PDD: "Consumer",
  // Financials
  JPM: "Financials", BAC: "Financials", WFC: "Financials", GS: "Financials",
  MS: "Financials", C: "Financials", SCHW: "Financials", BLK: "Financials",
  SPGI: "Financials", AXP: "Financials", V: "Financials", MA: "Financials",
  PYPL: "Financials", COF: "Financials", USB: "Financials", PNC: "Financials",
  TFC: "Financials", BX: "Financials", KKR: "Financials", CME: "Financials",
  SQ: "Financials", SOFI: "Financials", AFRM: "Financials", HOOD: "Financials",
  XLF: "Financials", KRE: "Financials", KBE: "Financials",
  // Crypto-adjacent
  COIN: "Crypto-adjacent", MARA: "Crypto-adjacent", RIOT: "Crypto-adjacent", MSTR: "Crypto-adjacent",
  // Healthcare
  UNH: "Healthcare", JNJ: "Healthcare", LLY: "Healthcare", MRK: "Healthcare",
  ABBV: "Healthcare", PFE: "Healthcare", TMO: "Healthcare", ABT: "Healthcare",
  DHR: "Healthcare", BMY: "Healthcare", AMGN: "Healthcare", GILD: "Healthcare",
  VRTX: "Healthcare", REGN: "Healthcare", ISRG: "Healthcare", MDT: "Healthcare",
  CVS: "Healthcare", CI: "Healthcare", HUM: "Healthcare", MRNA: "Healthcare",
  XLV: "Healthcare", XBI: "Healthcare", IBB: "Healthcare",
  // Industrials / transport
  CAT: "Industrials", DE: "Industrials", BA: "Industrials", GE: "Industrials",
  HON: "Industrials", LMT: "Industrials", RTX: "Industrials", UNP: "Industrials",
  UPS: "Industrials", FDX: "Industrials", XLI: "Industrials",
  AAL: "Industrials", DAL: "Industrials", UAL: "Industrials",
  F: "Industrials", GM: "Industrials", RIVN: "Industrials", LCID: "Industrials", NIO: "Industrials",
  ASTS: "Industrials", IONQ: "Industrials", RKLB: "Industrials",
  // Energy / utilities / materials
  XOM: "Energy", CVX: "Energy", COP: "Energy", SLB: "Energy", EOG: "Energy",
  OXY: "Energy", PSX: "Energy", MPC: "Energy", VLO: "Energy", KMI: "Energy",
  XLE: "Energy", XOP: "Energy", USO: "Energy",
  GEV: "Utilities", VST: "Utilities", CEG: "Utilities", XLU: "Utilities",
  ENPH: "Utilities", FSLR: "Utilities",
  FCX: "Materials", NEM: "Materials", NUE: "Materials", LIN: "Materials",
  DOW: "Materials", CLF: "Materials", AA: "Materials", XLB: "Materials",
  XME: "Materials", GLD: "Materials", SLV: "Materials", GDX: "Materials",
  // Real estate / rates / broad
  XLRE: "Real estate", XHB: "Real estate", ITB: "Real estate",
  TLT: "Bonds", HYG: "Bonds",
  SPY: "Index ETF", QQQ: "Index ETF", IWM: "Index ETF", DIA: "Index ETF",
  MDY: "Index ETF", RSP: "Index ETF", VTI: "Index ETF", VOO: "Index ETF", ARKK: "Index ETF",
  XLK: "Semis",
};

/** Sector for a ticker; pairs report their asset class, unknowns "Other". */
export function sectorOf(symbol: string): string {
  const sym = symbol.trim().toUpperCase();
  if (/^[A-Z0-9]{2,10}[/-][A-Z]{3}$/.test(sym)) return "Crypto/FX";
  return SECTOR_MAP[sym] ?? "Other";
}
