# VolumeShelfs

An anchored **volume-profile** analysis app. It reads volume as a function of
*price* (not time) and automatically surfaces the structures a discretionary
trader looks for:

- **Volume shelves** — contiguous clusters of high-volume price rows.
- **Break-even demand** — a shelf *below* price; tends to act as support
  (buyers who are back to break-even stop selling, so supply dries up).
- **Break-even supply** — a shelf *above* price; tends to act as resistance
  (holders who clawed back to break-even sell to get out).
- **Volume gaps** — thin "vacuum" zones with little traded volume, where price
  can move quickly because there is little friction.
- **POC** (point of control) and the **value area**.

You anchor the profile from a swing low or swing high (or click any candle), and
the engine recomputes the shelves, gaps and break-even zones live.

The app has two tabs:

- **Explore** — load one symbol and study its anchored volume profile.
- **Scanner** — run the full *Volume Shelf Scanner* checklist across a universe
  of tickers, rank the candidates, and drill into each one's chart, gates,
  trade plan and confirmation checklist.

![overview](docs/overview.png)
![scanner](docs/scanner.png)

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173
```

The app opens on bundled **offline demo data** so nothing is blank. Pick a data
source, enter a symbol and press **Load**.

```bash
npm run build    # type-check + production bundle into dist/
npm run preview  # serve the production build
npm test         # run the engine + parser unit tests (Vitest)
```

## Data sources

VolumeShelfs ships a small registry of providers (`src/data/`). The provider
dropdown, the API-key field and CSV import are all driven by it.

| Provider          | Key needed | Notes                                              |
| ----------------- | ---------- | -------------------------------------------------- |
| Demo data         | no         | Synthetic datasets bundled with the app (offline). |
| Alpha Vantage     | yes (free) | Daily/weekly/monthly equities, CORS-friendly.      |
| Twelve Data       | yes (free) | Stocks/ETF/FX/crypto, CORS-friendly.               |
| Stooq             | no         | Keyless CSV; may be CORS-blocked in some browsers. |
| CSV import        | —          | Drag in an OHLCV export from TradingView / broker. |

API keys are stored only in your browser's `localStorage`, never sent anywhere
except the provider you choose.

### Wiring in your own API

Implement the `DataProvider` interface and add it to the registry:

```ts
// src/data/providers/myApi.ts
import type { DataProvider } from "../types";
import { normalizeCandles } from "../types";

export const myApi: DataProvider = {
  id: "myapi",
  label: "My API",
  requiresApiKey: true,
  async fetchCandles(req, apiKey) {
    const res = await fetch(`https://example.com/ohlcv?symbol=${req.symbol}&key=${apiKey}`);
    const rows = await res.json();
    return normalizeCandles(
      rows.map((r) => ({
        time: r.t, open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v,
      })),
    );
  },
};
```

```ts
// src/data/index.ts
export const PROVIDERS: DataProvider[] = [sampleProvider, myApi, /* ... */];
```

`fetchCandles` returns `Candle[]` with `time` in **epoch seconds**. Candles can
be in any order — `normalizeCandles` sorts them and drops bad rows.

## How it works

```
src/
  core/                 # pure, DOM-free, unit-tested analysis engine
    volumeProfile.ts    #   anchored profile: binning, POC, value area
    shelves.ts          #   shelf / gap detection + break-even classification
    swings.ts           #   swing-pivot detection for auto-anchoring
    indicators.ts       #   SMA, ATR, anchored VWAP, returns, slope
    avwap.ts            #   AVWAP anchors (52w hi/lo, YTD, earnings) + pinch
    relativeStrength.ts #   RS vs a benchmark + RS line
    anchor.ts           #   per-ticker anchor selection
    scanner.ts          #   universe scan: gates, factors, scoring, ranking
    tradePlan.ts        #   entry / stop / target levels
  data/                 # pluggable data providers, CSV parser, demo universe
  chart/                # canvas renderer (candles, profile, AVWAP/MA overlays)
  scanner-ui.ts         # scanner tab: table, detail, trade plan, checklist
  main.ts               # app controller + tab wiring
```

### The engine

`computeAnchoredProfile(candles, anchorIndex, params)`:

1. Take the price range (lowest low → highest high) over the anchored window.
2. Split it into `rowCount` rows — equally spaced in **log** or **linear**
   price space.
3. Spread each candle's volume across the rows its high-low range overlaps,
   weighted by overlap (a wide bar is not dumped into a single bucket).
4. The heaviest row is the **POC**; the **value area** grows out from it toward
   the heavier neighbour until it covers the chosen fraction of volume.

`analyzeProfile(profile, currentPrice, params)` then:

- marks rows ≥ `shelfThreshold` × POC volume and merges adjacent ones into
  **shelves**, classifying each as break-even demand / supply / at-price
  relative to the current price;
- marks interior rows ≤ `gapThreshold` × POC volume as **volume gaps**.

All thresholds, the row count, the scale and the value-area fraction are
adjustable live in the UI.

## The scanner

The **Scanner** tab implements the Volume Shelf Scanner checklist (a repeatable
shelf + anchored-VWAP-pinch setup). It runs a universe through a stack of
computable filters, scores and ranks the survivors, then lets you confirm each
by eye.

### Universe

- **Demo universe (offline)** — ~16 bundled synthetic tickers plus a benchmark
  with a mix of leaders, laggards, extended and illiquid names. Runs instantly,
  no key.
- **Ticker list → API** — paste a watchlist and a benchmark (default `SPY`); the
  scanner fetches each ticker's daily bars through the selected provider and
  scans them. Daily bars are the documented approximation; intraday only sharpens
  true volume-at-price.

### Gates (computed per ticker)

| Gate | Passes when |
| ---- | ----------- |
| **Liquidity** | price ≥ min, 20-day avg dollar volume ≥ min |
| **Trend & MA** | above a flat-to-rising 200-day MA, and above/within X% of the 50-day MA |
| **Relative strength** | outperforms the benchmark over 1mo **and** 3mo, with the RS line near highs or above its own 50-day MA |
| **Volume shelf** | a support shelf (HVN run, ≥ k×mean volume) sits at/just below price, within X% of its midpoint, with the POC at/below price |
| **AVWAP pinch** | ≥ 2 anchored VWAPs (52w high/low, YTD open, earnings) cluster within X%, and price sits inside the pinch |
| **Contraction** | ATR(14) contracting and no high-volume breakdown bar through the shelf in the last 5 bars |

### Ranking

Each candidate gets a 0–100 score. Five factors — shelf strength, relative
strength, pinch tightness, proximity to the shelf, and range contraction — are
min-max normalized across the scanned set and combined with adjustable weights
(start equal-weighted, then re-weight toward whatever predicts your winners).
Candidates are ordered by hard-gate count first (so a clean downtrend with a
tight pinch can't outrank a real leader), then by score. Toggle **A+ only** to
show names that clear all six gates.

### Per-candidate detail

Click any row to load its chart with the support shelf, AVWAP lines (pinch
members solid), 50/200-day MAs, and the trade-plan levels drawn on it, plus:

- the **gate breakdown** (what passed/failed and why),
- a **trade plan** — reclaim entry, stop below the shelf, T1 (POC/next HVN), T2
  (VAH and the next LVN air-pocket), risk % and R-multiples,
- the **manual confirmation checklist** (the eyeball checks the scan can't do).

> The bundled demo universe is synthetic, so gate passes vary — the AVWAP-pinch
> and relative-strength gates in particular are strict. With live data the same
> engine runs unchanged.

## Tuning the controls

- **Rows** — more rows = finer price resolution (the video author favours ~50).
- **Scale** — use **log** for instruments with a large percentage range.
- **Value area** — fraction of volume defining the value area (70% standard;
  the video suggests 100% for a uniform look).
- **Anchor** — auto swing-low / auto swing-high / manual (click a candle).

## Disclaimer

This is an analysis and educational tool, not financial advice. Volume-profile
structure describes where trading has occurred; it does not predict the future.
