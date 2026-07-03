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

// ---- real index memberships (Wikipedia constituent tables, 2026-07-03) -----
// Share classes use Alpha Vantage's hyphen format (BRK-B). Index membership
// drifts a few names a year; a stale ticker just lands in the skipped row.

export const SP500: string[] = [
  "A", "AAPL", "ABBV", "ABNB", "ABT", "ACGL", "ACN", "ADBE", "ADI", "ADM",
  "ADP", "ADSK", "AEE", "AEP", "AES", "AFL", "AIG", "AIZ", "AJG", "AKAM",
  "ALB", "ALGN", "ALL", "ALLE", "AMAT", "AMCR", "AMD", "AME", "AMGN", "AMP",
  "AMT", "AMZN", "ANET", "AON", "AOS", "APA", "APD", "APH", "APO", "APP",
  "APTV", "ARE", "ARES", "ATO", "AVB", "AVGO", "AVY", "AWK", "AXON", "AXP",
  "AZO", "BA", "BAC", "BALL", "BAX", "BBY", "BDX", "BEN", "BF-B", "BG",
  "BIIB", "BKNG", "BKR", "BLDR", "BLK", "BMY", "BNY", "BR", "BRK-B", "BRO",
  "BSX", "BX", "BXP", "C", "CAH", "CARR", "CASY", "CAT", "CB", "CBOE",
  "CBRE", "CCI", "CCL", "CDNS", "CDW", "CEG", "CF", "CFG", "CHD", "CHRW",
  "CHTR", "CI", "CIEN", "CINF", "CL", "CLX", "CMCSA", "CME", "CMG", "CMI",
  "CMS", "CNC", "CNP", "COF", "COHR", "COIN", "COO", "COP", "COR", "COST",
  "CPAY", "CPRT", "CPT", "CRH", "CRL", "CRM", "CRWD", "CSCO", "CSGP", "CSX",
  "CTAS", "CTSH", "CTVA", "CVNA", "CVS", "CVX", "D", "DAL", "DASH", "DD",
  "DDOG", "DE", "DECK", "DELL", "DG", "DGX", "DHI", "DHR", "DIS", "DLR",
  "DLTR", "DOC", "DOV", "DOW", "DPZ", "DRI", "DTE", "DUK", "DVA", "DVN",
  "DXCM", "EA", "EBAY", "ECHO", "ECL", "ED", "EFX", "EG", "EIX", "EL",
  "ELV", "EME", "EMR", "EOG", "EQIX", "EQR", "EQT", "ERIE", "ES", "ESS",
  "ETN", "ETR", "EVRG", "EW", "EXC", "EXE", "EXPD", "EXPE", "EXR", "F",
  "FANG", "FAST", "FCX", "FDS", "FDX", "FDXF", "FE", "FFIV", "FICO", "FIS",
  "FISV", "FITB", "FIX", "FLEX", "FOX", "FOXA", "FRT", "FSLR", "FTNT", "FTV",
  "GD", "GDDY", "GE", "GEHC", "GEN", "GEV", "GILD", "GIS", "GL", "GLW",
  "GM", "GNRC", "GOOG", "GOOGL", "GPC", "GPN", "GRMN", "GS", "GWW", "HAL",
  "HAS", "HBAN", "HCA", "HD", "HIG", "HII", "HLT", "HON", "HONA", "HOOD",
  "HPE", "HPQ", "HRL", "HSIC", "HST", "HSY", "HUBB", "HUM", "HWM", "IBKR",
  "IBM", "ICE", "IDXX", "IEX", "IFF", "INCY", "INTC", "INTU", "INVH", "IP",
  "IQV", "IR", "IRM", "ISRG", "IT", "ITW", "IVZ", "J", "JBHT", "JBL",
  "JCI", "JKHY", "JNJ", "JPM", "KDP", "KEY", "KEYS", "KHC", "KIM", "KKR",
  "KLAC", "KMB", "KMI", "KO", "KR", "KVUE", "L", "LDOS", "LEN", "LH",
  "LHX", "LII", "LIN", "LITE", "LLY", "LMT", "LNT", "LOW", "LRCX", "LULU",
  "LUV", "LVS", "LYB", "LYV", "MA", "MAA", "MAR", "MAS", "MCD", "MCHP",
  "MCK", "MCO", "MDLZ", "MDT", "MET", "META", "MGM", "MKC", "MLM", "MMM",
  "MNST", "MO", "MOS", "MPC", "MPWR", "MRK", "MRNA", "MRSH", "MRVL", "MS",
  "MSCI", "MSFT", "MSI", "MTB", "MTD", "MU", "NCLH", "NDAQ", "NDSN", "NEE",
  "NEM", "NFLX", "NI", "NKE", "NOC", "NOW", "NRG", "NSC", "NTAP", "NTRS",
  "NUE", "NVDA", "NVR", "NWS", "NWSA", "NXPI", "O", "ODFL", "OKE", "OMC",
  "ON", "ORCL", "ORLY", "OTIS", "OXY", "PANW", "PAYX", "PCAR", "PCG", "PEG",
  "PEP", "PFE", "PFG", "PG", "PGR", "PH", "PHM", "PKG", "PLD", "PLTR",
  "PM", "PNC", "PNR", "PNW", "PODD", "PPG", "PPL", "PRU", "PSA", "PSKY",
  "PSX", "PTC", "PWR", "PYPL", "Q", "QCOM", "RCL", "REG", "REGN", "RF",
  "RJF", "RL", "RMD", "ROK", "ROL", "ROP", "ROST", "RSG", "RTX", "RVTY",
  "SBAC", "SBUX", "SCHW", "SHW", "SJM", "SLB", "SMCI", "SNA", "SNDK", "SNPS",
  "SO", "SOLV", "SPG", "SPGI", "SRE", "STE", "STLD", "STT", "STX", "STZ",
  "SW", "SWK", "SWKS", "SYF", "SYK", "SYY", "T", "TAP", "TDG", "TDY",
  "TECH", "TEL", "TER", "TFC", "TGT", "TJX", "TKO", "TMO", "TMUS", "TPL",
  "TPR", "TRGP", "TRMB", "TROW", "TRV", "TSCO", "TSLA", "TSN", "TT", "TTD",
  "TTWO", "TXN", "TXT", "TYL", "UAL", "UBER", "UDR", "UHS", "ULTA", "UNH",
  "UNP", "UPS", "URI", "USB", "V", "VEEV", "VICI", "VLO", "VLTO", "VMC",
  "VRSK", "VRSN", "VRT", "VRTX", "VST", "VTR", "VTRS", "VZ", "WAB", "WAT",
  "WBD", "WDAY", "WDC", "WEC", "WELL", "WFC", "WM", "WMB", "WMT", "WRB",
  "WSM", "WST", "WTW", "WY", "WYNN", "XEL", "XOM", "XYL", "XYZ", "YUM",
  "ZBH", "ZBRA", "ZTS",
];

export const NASDAQ_100: string[] = [
  "AAPL", "ABNB", "ADBE", "ADI", "ADP", "ADSK", "AEP", "ALAB", "ALNY", "AMAT",
  "AMD", "AMGN", "AMZN", "APP", "ARM", "ASML", "AVGO", "AXON", "BKNG", "BKR",
  "CCEP", "CDNS", "CEG", "CMCSA", "COST", "CPRT", "CRWD", "CRWV", "CSCO", "CSX",
  "CTAS", "DASH", "DDOG", "DXCM", "EA", "EXC", "FANG", "FAST", "FER", "FTNT",
  "GEHC", "GILD", "GOOG", "GOOGL", "HON", "IDXX", "INTC", "INTU", "ISRG", "KDP",
  "KHC", "KLAC", "LIN", "LITE", "LRCX", "MAR", "MCHP", "MDLZ", "MELI", "META",
  "MNST", "MPWR", "MRVL", "MSFT", "MSTR", "MU", "NBIS", "NFLX", "NVDA", "NXPI",
  "ODFL", "ORLY", "PANW", "PAYX", "PCAR", "PDD", "PEP", "PLTR", "PYPL", "QCOM",
  "REGN", "RKLB", "ROP", "ROST", "SBUX", "SHOP", "SNDK", "SNPS", "STX", "TER",
  "TMUS", "TRI", "TSLA", "TTWO", "TXN", "VRTX", "WBD", "WDAY", "WDC", "WMT",
  "XEL",
];

export const DOW_30: string[] = [
  "AAPL", "AMGN", "AMZN", "AXP", "BA", "CAT", "CRM", "CSCO", "CVX", "DIS",
  "GOOGL", "GS", "HD", "HON", "IBM", "JNJ", "JPM", "KO", "MCD", "MMM",
  "MRK", "MSFT", "NKE", "NVDA", "PG", "SHW", "TRV", "UNH", "V", "WMT",
];

export type UniverseId = "liquid" | "sp500" | "ndx" | "dow" | "everything";

export const UNIVERSE_LABELS: Record<UniverseId, string> = {
  liquid: "Liquid movers + ETFs",
  sp500: "S&P 500",
  ndx: "Nasdaq-100",
  dow: "Dow 30",
  everything: "Everything curated (S&P 500 + Nasdaq-100 + Dow + movers + ETFs)",
};

/** Build the chosen ticker universe, deduped and uppercased. */
export function universeOf(id: UniverseId): string[] {
  const pick: Record<UniverseId, string[]> = {
    liquid: [...MARKET_ETFS, ...MARKET_STOCKS],
    sp500: SP500,
    ndx: NASDAQ_100,
    dow: DOW_30,
    everything: [...MARKET_ETFS, ...MARKET_STOCKS, ...SP500, ...NASDAQ_100, ...DOW_30],
  };
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of pick[id]) {
    const u = t.trim().toUpperCase();
    if (u && !seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  }
  return out;
}
