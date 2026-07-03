# Footprint-feature ablation — absorption & AVWAP reclaim/defense

**Decision up front: both features are HELD (implemented, recorded on every
trade, `DEFAULT_FEATURE_TOGGLES` = all `false`). Neither showed a positive
out-of-sample expectancy delta that satisfies the promotion rule.**

- Absorption: **unmeasurable** — the gate fired on **0 of 637** signal bars at
  default thresholds (max n=1 anywhere in the sweep). No sample, no promotion.
- AVWAP reclaim/defense: fires on **73%** of signal bars; hit-rate separation
  is **+1.3 pts** (75.4% [71.3–79.1] vs 74.1% base) — the CI straddles the
  base rate, and conditioning on it fragments the tables below actionable
  sample, so the conditioned variant never beats baseline OOS. Not promoted.

## Setup

- Engine: `runBacktest` (long reversion-to-break-even hypothesis), default
  config — entry at t+1 open, stop-first intrabar rule, 20-bar time stop,
  1 bp/side base cost. Features computed by `computeFootprint` at the signal
  bar (close of t), spec-default parameters.
- Data: 24 liquid US large-caps (AAPL MSFT NVDA AMZN GOOGL META JPM XOM UNH
  HD CAT KO PG DIS BA GE F INTC CSCO WMT AMD MU DAL FCX), Yahoo daily OHLCV,
  10 years — 60,312 bars, **637 pooled trades**, window 2017-04-21 →
  2026-07-02. Runner: `npx vite-node scripts/run-ablation.ts -- <data dir>`.
- Harness: `src/core/ablation.ts` — 5 chronological folds, purge+embargo of
  25 days around each test fold, cells fit on train only. Act rule per cell:
  `n ≥ 20` AND `avgR − 1.96·SE(R) > 0` (a conservative expectancy floor —
  the same "CI lower bound" philosophy `decide()` uses live).

## Variants (identical trades, identical costs — only conditioning differs)

| Variant | Conditioning key |
|---|---|
| baseline | z-bucket |
| +absorption | z-bucket × absorption_bull on/off |
| +avwapEvent | z-bucket × (reclaim ∨ reclaim-hold ∨ defense) on/off |
| +both | z-bucket × both flags |

## Results — walk-forward OOS, 1 bp/side

| Variant | Taken / offered | Expectancy (R) | Hit | PF | MaxDD | P(hit\|on) [95% CI] | Base |
|---|---|---|---|---|---|---|---|
| baseline | 7 / 637 | +1.138 | 57.1% | 4.96 | 1.0R | — | 74.1% |
| +absorption | 7 / 637 | +1.138 | 57.1% | 4.96 | 1.0R | n=0 — never fires | 74.1% |
| +avwapEvent | 0 / 637 | 0 | — | — | — | 75.4% [71.3–79.1], n=467 | 74.1% |
| +both | 0 / 637 | 0 | — | — | — | 75.4% [71.3–79.1], n=467 | 74.1% |

Cost stress (1.5× and 2× bps): unchanged conclusions — baseline expectancy
+1.135 / +1.133; the conditioned variants still take 0 extra trades. (At 1 bp
base cost the stress is mild by construction; the binding problem is sample,
not cost.)

**Read the baseline honestly:** the conservative floor rule takes only 7 of
637 offered trades OOS — the pooled per-trade edge of the underlying setup is
thin in R terms (see per-bucket table), so a 7-trade +1.14R expectancy is
noise-level n, not a system. That context matters: a conditioning feature
can't rescue cells whose parent population barely clears zero.

## Per-bucket context (pooled, in-sample)

| Bucket | n | hit T1 | avg R | avwapEvent-on n | hit when on |
|---|---|---|---|---|---|
| A (0–1σ) | 513 | 78.8% | +0.015 | 378 | 79.6% |
| B (1–2σ) | 92 | 56.5% | −0.003 | 69 | 62.3% |
| C (2–3σ) | 26 | 53.8% | +0.706 | 17 | 41.2% |
| D (>3σ) | 6 | 33.3% | −0.093 | 3 | 33.3% |

High hit rates to a NEAR target with ~zero average R: winners are small
(break-even is close), losers are −1R. The AVWAP event helps bucket B's hit
rate (+5.8 pts on n=69) but hurts C — no consistent direction.

## Parameter robustness

**Absorption** (expectancy delta vs baseline; n = feature-on trades):

| VOL_MULT \ RANGE_MAX | 0.6 | 0.7 | 0.8 |
|---|---|---|---|
| 1.5 | +0.000 (n0) | +0.000 (n1) | +0.000 (n1) |
| 2.0 | +0.000 (n0) | +0.000 (n0) | +0.000 (n0) |
| 2.5 | +0.000 (n0) | +0.000 (n0) | +0.000 (n0) |

Zero incidence across the whole grid: heavy volume + compressed range +
level proximity essentially never coincides with this engine's quiet-dip
signal bars. The feature may have life on other setups (breakout bars,
intraday data) — on THIS trade universe it cannot even be measured.

**AVWAP event** (expectancy delta vs baseline):

| HOLD_BARS \ TOUCH_TOL | 0.001 | 0.002 | 0.004 |
|---|---|---|---|
| 1 | −1.269 (n494) | −1.277 (n515) | −1.179 (n534) |
| 2 | −1.138 (n445) | −1.138 (n467) | −1.138 (n495) |
| 3 | −1.235 (n452) | −1.474 (n468) | −1.138 (n498) |

Negative in every cell — and the mechanism is important: the deltas come from
the conditioned variant REFUSING to trade (its split cells never clear the
expectancy floor), not from the feature selecting worse trades. There is no
plateau of positive cells anywhere in the grid.

## Promotion decision (per the stated rule)

> Promote only on positive OOS expectancy delta that survives cost stress and
> is not confined to a single parameter cell.

- **Absorption — HOLD.** n=0 at signal bars; unmeasurable ⇒ stays
  implemented-but-disabled (`DEFAULT_FEATURE_TOGGLES.absorption = false`).
- **AVWAP reclaim/defense — HOLD.** Separation +1.3 pts with the CI straddling
  the base rate; every sweep cell's OOS delta ≤ 0 ⇒ stays disabled
  (`DEFAULT_FEATURE_TOGGLES.avwapEvent = false`).

Both remain recorded on every `Trade` (`footprint` field) and reportable via
`footprintAblation()`, so future re-evaluation on more data or a different
entry hypothesis is a config change, not a rebuild.

## Caveats (stated, not hidden)

- The 24-name universe is survivorship-tinged (today's liquid mega-caps);
  a delisted-inclusive universe could only make promotion HARDER.
- Yahoo daily data is split/dividend-adjusted; costs of 1 bp/side are
  optimistic for small accounts but were stressed 2× with no change.
- 637 trades across 9 years is modest; bucket C/D cells are single-digit.
- The baseline itself barely clears the OOS floor (7 trades taken) — any
  conditioning feature is fighting for scraps of sample on this hypothesis.
