/**
 * Trader playbooks — public styles of well-known market voices, distilled into
 * (a) what they actually do, (b) how THIS app maps it, and (c) where possible a
 * LIVE screen run over your last scan. Sources: their own posts/sites (see
 * docs/RESEARCH.md → "Trader playbooks"). These are style summaries for
 * education — nobody on this list endorses this app, and none of it is advice.
 */
import {
  athRead,
  doubleSupertrendUp,
  obvRead,
  shannonRead,
  type Candle,
  type ScanResult,
} from "../core";

export interface ScreenHit {
  ticker: string;
  note: string;
}

export interface Playbook {
  id: string;
  handle: string;
  name: string;
  url: string;
  /** One-line identity. */
  who: string;
  /** Their method, in their own terms. */
  style: string[];
  /** How VolumeShelfs implements / approximates it. */
  mapsTo: string[];
  /** Optional live screen over the scan (null = descriptive card only). */
  screen?: {
    label: string;
    /** Return a note when the name passes this playbook's screen. */
    test: (r: ScanResult, candles: Candle[]) => string | null;
  };
  caution?: string;
}

export const PLAYBOOKS: Playbook[] = [
  {
    id: "incomesharks",
    handle: "@IncomeSharks",
    name: "IncomeSharks",
    url: "https://x.com/IncomeSharks",
    who: "Chart-first stocks & crypto account — 'price action is noise, OBV is truth'.",
    style: [
      "On-Balance Volume (OBV) is the primary indicator: cumulative volume flow shows what money is DOING, not what price is saying.",
      "Draws trendlines on OBV itself — an OBV trendline break is an early tell before price follows.",
      "De-risks when price rises but OBV refuses to follow (rally without volume).",
      "Confirms trend with a DOUBLE SuperTrend (two settings must agree) before pressing.",
      "Openly contrarian to crowd sentiment at extremes.",
    ],
    mapsTo: [
      "The OBV screen below runs their exact divergence logic over your scan.",
      "The Early Signal's OBV component and the Institutional footprint's OBV trend are the same physics.",
      "Double SuperTrend (10/1.5 + 11/2.5) computed per name as the trend-confirm chip.",
    ],
    screen: {
      label: "OBV accumulation + trend confirm",
      test: (_r, candles) => {
        const o = obvRead(candles);
        if (!o) return null;
        const st = doubleSupertrendUp(candles);
        if (o.state === "accumulation") return `OBV climbing, price flat${o.obvLeadsPrice ? " · OBV already at new highs (leads price)" : ""}${st ? " · double SuperTrend UP" : ""}`;
        if (o.state === "confirmed" && o.obvLeadsPrice && st) return "OBV at new highs before price · double SuperTrend UP";
        return null;
      },
    },
  },
  {
    id: "brandt",
    handle: "@PeterLBrandt",
    name: "Peter Brandt",
    url: "https://x.com/PeterLBrandt",
    who: "50-year classical chartist (Factor). Verified track record across futures, FX, crypto.",
    style: [
      "Edwards & Magee classical patterns only — rectangles, triangles, H&S, flags — on DAILY and WEEKLY charts. No indicator soup.",
      "Risk ≈1% per trade; the stop lives where the PATTERN is invalidated, never where it's comfortable.",
      "Expects ~40% win rate — the edge is asymmetric reward:risk, not being right.",
      "'Strong opinions, weakly held' — flips sides without ego when the chart changes.",
    ],
    mapsTo: [
      "Weekly stage read + 52-week-high proximity approximates his breakout-from-pattern hunting ground.",
      "The discipline guard IS his risk pillar: 1% risk, structural stops (shelf low), R:R ≥ asymmetric.",
      "The screen: weekly stage 2 + within 5% of the 52-week high + plan R:R ≥ 2 — asymmetric breakout candidates.",
    ],
    screen: {
      label: "Weekly breakout candidates (asymmetric R:R)",
      test: (r, candles) => {
        if (candles.length < 260) return null;
        const shan = shannonRead(candles);
        if (shan.stage?.stage !== 2) return null;
        let hi52 = -Infinity;
        for (const c of candles.slice(-252)) if (c.high > hi52) hi52 = c.high;
        const near = (hi52 - r.price) / hi52;
        if (near > 0.05) return null;
        const rr = r.gapPlay?.active ? r.gapPlay.rr : null;
        if (rr !== null && rr < 2) return null;
        return `Stage 2 · ${(near * 100).toFixed(1)}% from 52w high${rr ? ` · ${rr.toFixed(1)}R play` : ""}`;
      },
    },
  },
  {
    id: "lindzon",
    handle: "@howardlindzon",
    name: "Howard Lindzon",
    url: "https://x.com/howardlindzon",
    who: "StockTwits founder; momentum investor ('Trends & Friends').",
    style: [
      "'8s to 80s': buy strength at/near ALL-TIME HIGHS — no overhead supply, no trapped sellers.",
      "Ride social + product momentum; cut quickly when the trend bends.",
      "Watchlists over predictions — let leaders announce themselves.",
    ],
    mapsTo: [
      "The screen: names within 5% of their all-time (loaded-history) high in a confirmed uptrend.",
      "Same physics as the app's break-even supply logic — at ATH there is NO break-even supply above.",
    ],
    screen: {
      label: "At/near all-time highs (no overhead supply)",
      test: (r, candles) => {
        const a = athRead(candles);
        if (!a?.nearAth || !r.gates.trend.pass) return null;
        return a.headline;
      },
    },
  },
  {
    id: "burns",
    handle: "@SJosephBurns",
    name: "Steve Burns",
    url: "https://x.com/SJosephBurns",
    who: "20+ year trend follower and trading author (New Trader U).",
    style: [
      "Trend following with moving averages — trade the direction of the 200-day, don't argue with it.",
      "Position sizing and stop losses beat prediction; survive first, compound second.",
      "Trade the chart, not your opinion of the company.",
    ],
    mapsTo: [
      "The screen: price above a rising 200-day AND above the 50-day — the only regime he'd be long.",
      "The app's trend gate + regime light + 1% risk sizing are his rules, encoded.",
    ],
    screen: {
      label: "Clean trend-following longs",
      test: (r) =>
        r.gates.trend.pass && r.aboveMa200 && r.price > r.ma50 && r.ma200Slope === "rising"
          ? "Above rising 200-day and above the 50-day"
          : null,
    },
  },
  {
    id: "sonders",
    handle: "@LizAnnSonders",
    name: "Liz Ann Sonders",
    url: "https://x.com/LizAnnSonders",
    who: "Chief investment strategist, Charles Schwab — macro through charts.",
    style: [
      "Breadth over headlines: what % of stocks are participating tells the truth about a rally.",
      "Sector leadership shifts flag regime changes early.",
      "Valuation + macro data, never single-stock tips.",
    ],
    mapsTo: [
      "The Rotation tab's breadth column and the Mission Control 'breadth in uptrend' tile are her lens.",
      "Watch: rallies where breadth falls apart (index up, % above 200-day down) — her classic warning.",
    ],
  },
  {
    id: "bilello",
    handle: "@charliebilello",
    name: "Charlie Bilello",
    url: "https://x.com/charliebilello",
    who: "Data-driven market historian — tables and charts, zero hype.",
    style: [
      "Long-horizon data tables: what actually happened after X historically.",
      "Base rates over stories; lets 100 years of data argue.",
      "Highlights extremes (valuations, streaks, drawdowns) when they're historic.",
    ],
    mapsTo: [
      "The Model panel's probability tables + base-rate controls are exactly this philosophy applied per setup.",
      "The journal's expectancy is your own personal base rate — his method turned inward.",
    ],
  },
  {
    id: "ritholtz",
    handle: "@ritholtz",
    name: "Barry Ritholtz",
    url: "https://x.com/ritholtz",
    who: "CIO of Ritholtz Wealth; behavioral-finance voice (Masters in Business).",
    style: [
      "Your biggest risk is your own behavior — panic, FOMO, overtrading.",
      "Process over outcome; tune out financial media noise.",
      "Long-term evidence-based allocation beats hot takes.",
    ],
    mapsTo: [
      "The discipline guard (anti-martingale, drawdown breaker, heat cap) is behavioral finance as code.",
      "The journal + edge breakdown make your OWN behavior visible — his whole thesis.",
    ],
  },
  {
    id: "capitoltrades",
    handle: "@CapitolTrades",
    name: "CapitolTrades",
    url: "https://x.com/CapitolTrades",
    who: "Tracks U.S. politicians' personal stock disclosures.",
    style: [
      "Surfaces congressional trading disclosures (STOCK Act filings) as they publish.",
      "The signal: clusters of insider-adjacent buying in one sector/name.",
    ],
    mapsTo: [
      "No politician-trade data feed exists in this app (honest limit) — use their site for the raw filings.",
      "Cross-check their clusters against your scan: a disclosed buy PLUS an A/B institutional footprint here is confluence.",
    ],
    caution: "Disclosures arrive up to 45 days late — treat as context, not a trigger.",
  },
  {
    id: "vannelli",
    handle: "Walter Vannelli",
    name: "Walter Vannelli",
    url: "https://x.com/search?q=Walter%20Vannelli",
    who: "35+ year FX veteran; long-horizon technical views.",
    style: [
      "Multi-month FX trends on weekly charts; patience over frequency.",
      "Technical levels respected across years, not days.",
    ],
    mapsTo: [
      "Load EUR/USD (or any pair) in Explore on the weekly interval — the AVWAP map + shelves work on FX too.",
    ],
  },
  {
    id: "tnut",
    handle: "@Teeznutz11",
    name: "Tnut",
    url: "https://x.com/Teeznutz11",
    who: "Crypto + market commentary; risk lessons wrapped in memes.",
    style: ["Crypto momentum with explicit risk framing; survives by sizing small on high-volatility bets."],
    mapsTo: ["BTC/USD and pairs load in Explore; the discipline guard's sizing rules matter MOST at crypto volatility."],
    caution: "High-volatility speculation — half-size or less per the guard.",
  },
  {
    id: "tradinglord",
    handle: "@Tradinglord",
    name: "Tradinglord",
    url: "https://x.com/tradinglord",
    who: "Crypto trader — bold calls, real trade stories.",
    style: ["Speculative, high-beta crypto setups; entertainment-adjacent — extract the risk lessons, skip the euphoria."],
    mapsTo: ["Same crypto support + tape-quality screen; the anomaly scan exists precisely for pump-shaped charts."],
    caution: "Bold public predictions are content, not a system — the Final Call stays the referee.",
  },
];
