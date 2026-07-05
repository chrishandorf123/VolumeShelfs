# Research notes — the rules the app enforces

VolumeShelfs's discipline guard, regime filter and final-call logic implement
the risk-management practices the trading literature broadly agrees on. This
file records what was researched and where each rule in the code comes from.

## Position sizing: the 1% standard, 2% ceiling

- Most professionals risk **1% or less per trade**; 1–2% keeps a 10-loss streak
  to a recoverable 10–20% drawdown, while 10%/trade loses 65% on the same
  streak and needs +186% to recover.
- Sizing matters more than entries: a mediocre strategy with proper sizing
  outperforms a great strategy with reckless sizing.
- Implemented in `src/core/discipline.ts` (`risk` check: pass ≤1%, warn ≤2%,
  fail above) and the risk-based position sizer.

Sources: [Trade That Swing — the 1% risk rule](https://tradethatswing.com/the-1-risk-rule-for-day-trading-and-swing-trading/),
[Chart Guys — position sizing](https://www.chartguys.com/articles/position-sizing),
[TradeZella — position size calculator](https://www.tradezella.com/blog/position-size-calculator),
[TradingSim — position sizing guide](https://www.tradingsim.com/blog/position-sizing-guide)

## Portfolio heat: cap total open risk at ~4–6%

- Heat = what you lose if **every** open stop hits on the same (correlated)
  day. Recommendations cluster at 4–8% with professionals often capping at
  5–6%; above 10% one macro event can cripple the account.
- Position count follows from heat: at 1–2% per trade, ~4–6 concurrent
  positions is the practical ceiling.
- Implemented in `discipline.ts` (`heat`: pass ≤4%, warn ≤6%, fail above;
  `count`: pass <5, fail ≥8; `dup`: no doubling into a held symbol).

Sources: [Pro Trader Dashboard — portfolio heat management](https://protraderdashboard.com/blog/portfolio-heat-management/),
[JournalPlus — portfolio heat](https://journalplus.co/metrics/portfolio-heat/),
[QuantVPS — trading risk management](https://www.quantvps.com/blog/trading-risk-management),
[TradeAlgo — swing trading risk management](https://www.tradealgo.com/trading-guides/stocks/swing-trading-risk-management-position-sizing-stop-losses-and-portfolio-rules)

## The 200-day regime filter

- Long entries only in structurally bullish environments: above a rising
  200-day, breakouts succeed more often; the filter's main job is **keeping
  you out of bear markets**, where rallies stall at the 50/200-day and
  breakouts fail at elevated rates.
- Implemented in `src/core/regime.ts` (benchmark stage + weekly bias →
  GREEN/YELLOW/RED) and enforced direction-aware in `discipline.ts` — red
  vetoes new longs, green vetoes shorts.

Sources: [QuantifiedStrategies — 200-day MA strategy backtests](https://www.quantifiedstrategies.com/200-day-moving-average-trading-strategy/),
[Bulkowski — moving average study](https://www.thepatternsite.com/MovingAvgs.html),
[Investing.com — 200-day retests](https://www.investing.com/analysis/retest-of-the-200day-moving-average-isnt-bearishunless-it-fails-200661808)

## Algo-trading pitfalls the app already guards against

- **Overfitting**: too-good backtests break live. The app's backtest uses
  point-in-time (no-lookahead) computation, Wilson confidence intervals on
  small samples, base-rate controls, IS/OOS splits, non-overlapping trades,
  and a minimum-sample gate before the model may say TAKE.
- **Drawdown control / anti-martingale**: reduce size after losses, never
  increase it to "get it back". Implemented as the cold-streak and
  drawdown-circuit-breaker checks (halve size after 3 straight losses,
  negative 10-trade expectancy, or a 5R journal drawdown).
- **Explicit exposure caps and circuit breakers** beat post-hoc discipline.
  That is the entire purpose of `checkDiscipline` running BEFORE every trade
  and of the final call's absolute vetoes (`src/core/finalCall.ts`).

Sources: [uTrade Algos — overfitting risks](https://www.utradealgos.com/blog/why-overfitting-is-a-risk-to-your-algo-trading-success-and-how-to-combat-it),
[EFX Algo — top algo trading mistakes](https://efxalgo.com/2025/12/18/top-algo-trading-mistakes-and-how-to-avoid-them/),
[Nurp — common algorithmic trading errors](https://nurp.com/algorithmic-trading-blog/common-algorithmic-trading-errors-and-solutions/),
[TradingWyckoff — algo trading metrics](https://tradingwyckoff.com/en/algorithmic-trading/algorithmic-trading-metrics/)

## Sector rotation detection (the Rotation tab)

The Rotation tab implements the industry-standard **Relative Rotation Graph
(RRG)** methodology developed by Julius de Kempenaer, plus the breadth
cross-checks professionals use to confirm that "money is rotating."

**The math (core/rotation.ts).** For each sector ETF vs the benchmark (SPY):

1. RS = sector close ÷ benchmark close (raw relative strength line).
2. Smooth RS with an EMA (alpha = 2/(m+1), m = 14 periods).
3. **JdK RS-Ratio** = 100 + 10 × z-score of the smoothed RS against its own
   rolling mean/σ over the same window — >100 means a relative UPTREND vs
   the market, <100 a relative downtrend. Normalization makes sectors
   directly comparable on one chart.
4. **JdK RS-Momentum** = the same normalization applied to the rate of change
   of RS-Ratio — momentum leads ratio, so it turns first.
5. Weekly bars, per the standard RRG convention (daily is too noisy for
   sector-level rotation): the app resamples its daily candles to weekly.

**The four quadrants** (RS-Ratio × RS-Momentum): **Leading** (+/+) — strong
and getting stronger, money is here; **Weakening** (+/−) — still strong but
momentum cracked, the earliest warning a leader gives; **Lagging** (−/−) —
weak and falling, money has left; **Improving** (−/+) — still weak but the
downtrend is stalling: this is where rotations BEGIN. Sectors travel
clockwise through the quadrants; a move from Improving → Leading is money
rotating IN, Leading → Weakening is the first crack of money rotating OUT.

**Evidence for the approach.** Sector momentum/rotation is one of the older
documented edges: a simple relative-momentum strategy beat buy-and-hold about
70% of the time across 80+ years of sector data, with 1-, 3-, 6-, 9- and
12-month lookbacks all working; excess returns are real but modest (~1–3%/yr
in large studies), with a 2025 TSX-60 study finding 6-month lookbacks the
best signal-to-noise (3-month works, slightly noisier). The app therefore
shows 1-month AND 3-month relative returns beside the RRG read, and treats
rotation as a WHERE-to-hunt filter, not a standalone system.

**Breadth confirmation.** Price-only rotation reads can be head-fakes, so the
tab cross-checks the scan's own breadth per sector: % of members above their
50-day average, average RS, and count of A+ setups. Falling 50-day breadth
while the sector ETF still looks fine is fading leadership; expanding breadth
in an Improving sector is confirmation the rotation is real.

Sources: [StockCharts ChartSchool — Relative Rotation Graphs](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/chart-types/relative-rotation-graphs-rrg-charts),
[StockCharts — RRG Relative Strength (JdK RS-Ratio/RS-Momentum)](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/rrg-relative-strength),
[Quantpedia — Sector Momentum Rotational System](https://quantpedia.com/strategies/sector-momentum-rotational-system),
[MDPI (2025) — Sector Rotation Strategies in the TSX 60](https://www.mdpi.com/1911-8074/19/1/70),
[StockCharts — Faber's Sector Rotation Strategy](https://chartschool.stockcharts.com/table-of-contents/trading-strategies-and-models/trading-strategies/fabers-sector-rotation-trading-strategy),
[TrendSpider — Sector Rotation: Track Where the Money Is Moving](https://trendspider.com/blog/sector-rotation-how-to-track-where-the-money-is-moving/),
[StockCharts — Using RRGs to Visualize Sector Rotation](https://articles.stockcharts.com/article/articles-rrg-2025-07-using-relative-rotation-graphs-to-visualize-sector-rotation/)

## Retracement vs reversal (the Dip grader)

Implements the classic Investopedia framework for telling a pullback from a
trend change: retracements are LOW-volume, short-lived counter-moves that hold
Fibonacci zones (38.2–61.8% of the prior impulse) with trend structure (higher
lows) intact; reversals come on HIGH volume, run beyond 61.8–78.6%, build
lower highs, and break the prior swing low. The Dip grader
(core/retracement.ts) measures each of those on the most recent impulse leg
and reports a verdict + the fib ladder + the 78.6% invalidation.

Sources: [Investopedia — Retracement or Reversal: Know the Difference](https://www.investopedia.com/articles/trading/05/020305.asp),
[Investopedia — Retracements vs Reversals](https://www.investopedia.com/articles/trading/06/retracements.asp),
[FXOpen — Retracement vs Reversal](https://fxopen.com/blog/en/retracement-vs-reversal-whats-the-difference/)

## Trader playbooks (the Playbooks tab)

Style summaries are drawn from each account's own public output; the live
screens implement the mechanical part of each style honestly and say so when
no data exists (CapitolTrades). Key sources:

- IncomeSharks — OBV-first analysis, OBV trendlines, double SuperTrend:
  [their X account](https://x.com/IncomeSharks),
  [strategy writeup](https://bitcoinshrimps.medium.com/using-the-incomesharks-trading-strategy-a-simple-but-very-effective-strategy-c59c99b961d6),
  [TradingView scripts](https://www.tradingview.com/u/IncomeSharks/)
- Peter Brandt — classical charting, 1% risk, pattern-invalidation stops:
  [Factor Trading](https://www.peterlbrandt.com/),
  [Four Pillars of Factor](https://www.peterlbrandt.com/knowledge-center/four-key-pillars-factor/)
- Howard Lindzon — momentum near all-time highs ("8s to 80s"): his public
  posts and StockTwits writing.
- Steve Burns, Liz Ann Sonders, Charlie Bilello, Barry Ritholtz,
  CapitolTrades, Walter Vannelli, Tnut, Tradinglord — style summaries from
  their public accounts; descriptive cards only where the app has no
  matching data feed.

## Honest limitations (nothing is fool-proof)

- Client-side EOD/delayed data — not tick-accurate; fills are assumed, not real.
- The backtest is single-symbol history, not a survivorship-free universe study.
- Correlation inside portfolio heat is approximated by the position cap, not a
  correlation matrix.
- Short-side mechanics ignore borrow availability/fees and squeeze dynamics.
- No strategy survives contact with markets unchanged: the journal's
  expectancy is the ongoing test — if it goes negative, the guard says so.
