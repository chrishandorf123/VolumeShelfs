/**
 * A curated universe of liquid, tradeable US names + ETFs to scan. This is not
 * "every stock in the market" (thousands of micro-caps just fail the liquidity
 * gate and waste API calls) — it's the deep, liquid pool where the volume-shelf
 * method actually works, across every sector, plus the major index/sector ETFs.
 * Edit freely; the scanner treats it as a plain ticker list.
 */
export const MARKET_ETFS: string[] = [
  "SPY", "QQQ", "IWM", "DIA", "MDY", "RSP", "VTI", "VOO",
  "XLK", "XLF", "XLE", "XLV", "XLI", "XLY", "XLP", "XLU", "XLB", "XLRE", "XLC",
  "SMH", "SOXX", "XBI", "IBB", "XOP", "XME", "XRT", "XHB", "ITB", "KRE", "KBE",
  "GLD", "SLV", "GDX", "USO", "TLT", "HYG", "ARKK",
];

export const MARKET_STOCKS: string[] = [
  // mega-cap tech / comms
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "AVGO", "TSLA", "ORCL", "ADBE",
  "CRM", "AMD", "INTC", "QCOM", "TXN", "MU", "AMAT", "LRCX", "KLAC", "ADI",
  "NFLX", "CSCO", "IBM", "NOW", "INTU", "PANW", "SNPS", "CDNS", "ANET", "PLTR",
  "SHOP", "UBER", "ABNB", "SNOW", "CRWD", "DDOG", "NET", "MDB", "ZS", "SMCI",
  "MRVL", "ON", "MCHP", "ARM", "DELL", "HPQ", "WDC", "STX",
  // financials
  "JPM", "BAC", "WFC", "GS", "MS", "C", "SCHW", "BLK", "SPGI", "AXP",
  "V", "MA", "PYPL", "COF", "USB", "PNC", "TFC", "BX", "KKR", "CME",
  "COIN", "HOOD", "SOFI", "AFRM",
  // healthcare
  "UNH", "JNJ", "LLY", "MRK", "ABBV", "PFE", "TMO", "ABT", "DHR", "BMY",
  "AMGN", "GILD", "VRTX", "REGN", "ISRG", "MDT", "CVS", "CI", "HUM", "MRNA",
  // consumer / retail
  "WMT", "COST", "HD", "LOW", "TGT", "NKE", "SBUX", "MCD", "CMG", "PG",
  "KO", "PEP", "PM", "MO", "DIS", "LULU", "DECK", "ROST", "TJX", "DG",
  // industrials / energy / materials
  "CAT", "DE", "BA", "GE", "HON", "LMT", "RTX", "UNP", "UPS", "FDX",
  "XOM", "CVX", "COP", "SLB", "EOG", "OXY", "PSX", "MPC", "VLO", "KMI",
  "FCX", "NEM", "NUE", "LIN", "DOW", "CLF", "AA",
  // autos / EV / high-beta movers
  "F", "GM", "RIVN", "LCID", "NIO",
  // other liquid / volatile names traders watch
  "BABA", "PDD", "MARA", "RIOT", "CVNA", "DKNG", "RBLX", "U", "ROKU", "PINS",
  "SNAP", "SQ", "ASTS", "IONQ", "RKLB", "CCL", "AAL", "DAL", "UAL", "T",
  "VZ", "TMUS", "GEV", "VST", "CEG", "ENPH", "FSLR", "TSM", "MSTR",
];

/** The full curated universe (ETFs + stocks), deduped, uppercased. */
export function marketUniverse(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...MARKET_ETFS, ...MARKET_STOCKS]) {
    const u = t.trim().toUpperCase();
    if (u && !seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  }
  return out;
}
