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

![overview](docs/overview.png)

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
  data/                 # pluggable data providers + CSV parser
  chart/                # canvas renderer (candles, profile overlay, zones)
  main.ts               # app controller wiring the pieces together
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

## Tuning the controls

- **Rows** — more rows = finer price resolution (the video author favours ~50).
- **Scale** — use **log** for instruments with a large percentage range.
- **Value area** — fraction of volume defining the value area (70% standard;
  the video suggests 100% for a uniform look).
- **Anchor** — auto swing-low / auto swing-high / manual (click a candle).

## Disclaimer

This is an analysis and educational tool, not financial advice. Volume-profile
structure describes where trading has occurred; it does not predict the future.
