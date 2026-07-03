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

## Honest limitations (nothing is fool-proof)

- Client-side EOD/delayed data — not tick-accurate; fills are assumed, not real.
- The backtest is single-symbol history, not a survivorship-free universe study.
- Correlation inside portfolio heat is approximated by the position cap, not a
  correlation matrix.
- Short-side mechanics ignore borrow availability/fees and squeeze dynamics.
- No strategy survives contact with markets unchanged: the journal's
  expectancy is the ongoing test — if it goes negative, the guard says so.
