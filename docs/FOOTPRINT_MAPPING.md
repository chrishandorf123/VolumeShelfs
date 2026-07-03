# FOOTPRINT_MAPPING — existing primitives the absorption / AVWAP-event features reuse

Step-0 inventory for the "Institutional Absorption" and "AVWAP Reclaim/Defense"
features. Everything below was read from the code, not assumed. Where the spec
and the engine disagree, **the engine's convention wins** and the deviation is
noted at the bottom.

## 1. Bar / OHLCV structure

`src/core/types.ts` → `interface Candle { time; open; high; low; close; volume }`
- `time` is **epoch seconds, UTC**; calendar logic (year-open anchor) uses
  `getUTCFullYear()` (`backtest.ts:161`). Daily bars are the model's calibrated
  interval (the UI refuses to run the model on weekly/monthly).
- No timezone gymnastics anywhere else — features must treat `time` as opaque
  ordering except for calendar anchors.

## 2. AVWAP computation

Two implementations, both volume-weighted **HLC3**:
- `src/core/indicators.ts:76` `anchoredVwapSeries(candles, anchorIndex)` — full
  series, O(n) per anchor. Used by the UI.
- `src/core/backtest.ts:183-192` — **prefix-sum** `avwap(a, t)` giving O(1)
  anchored VWAP for any (anchor, bar) pair. **This is the one to reuse** for
  multi-anchor per-bar evaluation.

Anchor supply in the model (`backtest.ts:194-229`): *running* extremes
(`runningExtremeIndex` all-time high/low, `windowedExtremeIndex` 52-week
high/low — both computed per-bar from data ≤ t) plus calendar year-open
(`yearOpenIndex`). These are **already anti-lookahead**: at bar t the "ATH
anchor" is the argmax over [0..t], not the hindsight global extreme. The
"operative AVWAP" is the nearest anchored VWAP **above** close (`opVwap`),
which is T1/break-even for the reversion hypothesis.

**Missing for the spec:** swing-pivot anchors with explicit confirmation lag.
`src/core/swings.ts` `detectSwings(candles, lookback=5)` finds pivots with
half-width k each side but stamps them at `pivot.index` — using its output
naively at bar `pivot.index` is lookahead (the pivot needs k more bars to
confirm). **Addition:** a `confirmedSwingAnchors()` provider that emits
`{ anchorBar, confirmedAtBar = anchorBar + k }` and an AVWAP-event evaluator
that only reads a series from `confirmedAtBar` onward. Gap anchors
(open − prior close > GAP_ATR·ATR) are new but trivially point-in-time.

## 3. VBP histogram and POC/HVN/LVN

- `src/core/volumeProfile.ts:137` `computeAnchoredProfile(candles, anchorIndex,
  params, endIndex?)` — **`endIndex` makes it point-in-time**; the backtest
  already calls it with `endIndex = t` (`backtest.ts:304`).
- `src/core/shelves.ts` → `detectHvnShelves(profile, price, shelfK, minRows)`,
  `nearestShelves(shelves, price)`, `detectGaps(profile, thresholds)` (LVNs).
- Engine convention (`evalBar`, `backtest.ts:294-319`): the profile is
  **expensive and computed only after cheap gates pass**. The absorption
  feature follows the same discipline: `level_proximity` (needs POC/HVN) is
  evaluated **only** on bars that already pass the cheap volume/range/close
  conditions; other bars record the boolean as false and proximity as NaN.

## 4. ATR / volatility helpers

- `src/core/indicators.ts:33` `atrSeries(candles, period=14)` — trailing
  true-range average (includes prior close ⇒ gap-aware), NaN until warm.
  Reused as-is for `range_ratio`, `level_proximity` (ATR units), `dist_atr`,
  and the GAP_ATR gap-anchor threshold.
- Volume MA exists only as private `avgVol(candles, t, n)` in backtest.ts
  (trailing, excludes bar t). **Addition:** a public trailing
  `volRatioSeries` in the feature module (SMA window N_vol = 20, ratio of
  bar-t volume to the average of the prior 20 — same exclusion convention).

## 5. decide() and the probability-table interface

- `src/core/probabilityTable.ts` `buildTables(trades, candles, config)` →
  `Tables { byBucket, byBucketRegime, baseRateAll }`. Cells are keyed
  `bucket × regime`, carry `n`, `hitRateT1`, Wilson `ciT1`, `avgR`
  (= expectancy in R), MAE quantiles, and an **unconditional base-rate
  control** (`baseRateForMove`) with `edgeOverBase = ciT1[0] > baseRate`.
- `src/core/decide.ts` `decide(live, tables, sizing)` — picks the
  regime-specific cell if `n ≥ minSampleN (30)`, else the bucket-wide cell
  (flagged `lowSample` → WATCH), refuses to act without `edgeOverBase`,
  sizes by fractional Kelly **on the CI lower bound**, capped at 1% risk.
- **How features become conditioning variables today:** confirmation gates
  (`Gates` on each `Trade`, recorded at the signal bar, never baked into
  entry) + `gateAblation(trades)` reporting marginal hit-rate/R per gate per
  bucket. The new features follow this exact pattern: recorded on `Trade`
  (new `footprint` field), reported via ablation, and **only** promoted into
  decide()'s cell lookup behind an explicit config toggle (default OFF).

## 6. Backtest fill model / decision timing

`backtest.ts:330-364` + `simulate()`:
- Signal read at **close of bar t** (all features ≤ t); entry at **bar t+1
  open** — the engine's actionable point. New features conform.
- Costs: `costBps` (default 1bp) applied per side; `rMultiple` is net.
- Intrabar rule: **stop first** (conservative), then T1; T2 measured
  independently pre-stop; 20-bar time stop; one position at a time
  (`nextEligible` — overlapping signals are one episode, keeping table N
  honest).
- `Trade` stores `entryPrice`, `exitPrice`, `perShareRisk` → R can be
  **recomputed at any cost level** for the 1.5–2× slippage stress without
  re-simulating.

## 7. Ablation / confirmation-gate framework

What exists: `gateAblation()` — **in-sample marginal** conditioning per gate
per bucket, with Wilson CIs. What's missing for the spec's requirements:
- **Walk-forward / purged OOS evaluation** — nothing in the repo fits bins on
  train folds and evaluates held-out folds. **Addition:** `src/core/ablation.ts`
  with chronological K-fold walk-forward over trades, an **embargo of
  `timeStopBars` bars** around fold boundaries (trades whose exit window
  overlaps the boundary are dropped from train), variant definitions
  (baseline / +absorption / +avwap / +both), and per-variant metrics: trade
  count, expectancy (avg R), hit rate, avg win / avg loss, profit factor,
  max drawdown of the cumulative-R curve, and conditional separation
  P(hit | feature on) vs P(hit | all) with Wilson CIs.
- Parameter sweep + cost stress are driven by the same harness.

## 8. Missing primitives — summary of minimal additions

| Missing | Minimal addition | Where |
|---|---|---|
| Public trailing volume ratio | `volRatioSeries()` (SMA N_vol, excludes bar t) | `footprint.ts` |
| Confirmed swing anchors | `confirmedSwingAnchors()` → `{anchorBar, confirmedAtBar}` | `footprint.ts` |
| Gap anchors | open-vs-prior-close > GAP_ATR·ATR provider | `footprint.ts` |
| Feature frame on trades | `footprint: FootprintSnapshot` on `Trade` + `LiveState` | `backtest.ts` |
| OOS ablation harness | `ablation.ts` (walk-forward, embargo, variants, stress) | new |
| Feature promotion switch | `FeatureToggles` consumed by `buildTables`/`decide` (default off) | `probabilityTable.ts` / `decide.ts` |

No new data feeds and no new libraries are required. (The ablation *report*
uses free daily OHLCV pulled once by a repo script; the engine itself gains no
dependency.)

## 9. Deviations from the spec (engine convention preferred)

1. **"Prior session open / settlement" anchors**: the engine is daily-bar
   only, so intraday session anchors don't exist; the calendar family here is
   year-open (existing) + gap bars + confirmed pivots. Noted, not silently
   changed.
2. **`level_proximity` levels**: spec allows "VBP level or swing level" — the
   engine's level vocabulary is POC/HVN from the *operative anchored profile*
   (plus nearest shelf below), so those are the levels used; computed only on
   cheap-gate-passing bars per engine convention (§3).
3. **Feature direction**: this engine's tradable hypothesis is long-only
   reversion; bearish absorption / AVWAP-loss are still computed and recorded
   (they may condition *against* taking the long) but there is no short
   trade path to ablate them on.
4. **Probability binning**: engine cells are categorical (bucket × regime ×
   gate-style booleans), not continuous-score bins — continuous scores are
   recorded on the trade for analysis, but table conditioning uses the
   boolean gates, consistent with `Gates`/`gateAblation`.
