# @Mr_Derivatives ("Heisenberg") — a complete reconstruction of his trading strategy

*Research dossier, July 2026. Built from 64,865 of his archived tweets (Feb 2021 – Jul 2026),
275 archived tweets of his public $100k trade-journal account (@Heisenberg_100k), and a
98-agent adversarially-verified web-research pass. Every claim below is either quoted from
him verbatim (with date) or explicitly labeled as inference.*

---

## TL;DR

**@Mr_Derivatives is not a volume-profile trader.** Across 64,865 archived tweets spanning
5.5 years there are **zero** uses of "volume shelf", "volume profile", "volume by price",
"POC", "HVN/LVN", "anchored VWAP", "VWAP", or "air pocket" (in the volume sense). The
volume-shelf methodology this repo implements comes from a different school (TrendSpider /
Brian Shannon AVWAP); it is not his.

What he actually is: a **contrarian mean-reversion swing trader** who buys oversold
extremes and fades overbought ones at *classical* technical levels — trendlines, 50/200-day
moving averages, prior breakout points, price gaps, round numbers — executed ~90% through
**common shares plus short-dated written options** (cash-secured puts and credit spreads,
0.15–0.30 delta, 1–3 week expiries), with small "subway sandwich" sizing on speculative
bets, ruthless profit-taking, and a self-admitted ~50% hit rate where the edge is claimed
to come from risk management, not prediction.

His own summary of his toolkit (2024-06-12):

> "Yep. Rsi. 50 and 200 dma. Bollinger bands. Then certain candlestick formations. Wedges,
> dbl tops/bottoms, triangles, h&s, cup handles. I keep it simple."

And of his execution (2026-03-12):

> "90% of my trades are done longing or shorting common shares and writing options (CSP's,
> Naked calls, PCS's, and CCS's). And typically the expirations are no greater than a week
> or two or three at most. I just like writing options."

---

## 1. Who he is

- Pseudonymous. Display name **Heisenberg** (Breaking Bad; Walter White avatar). Bio, stable
  2023→2026: *"Stock Market Commentary. Long/Short Ideas. Technical Analysis. Occasional
  Rants & Humor. Not Financial Advice."*
- History: Stocktwits 2013–2019 (~17–40k followers, blew up an account at some point:
  "I then took a break because I had blown a…" 2025-10-25), X account created Jan 2018 but
  idle until Feb 2021 ("Just opened up my twitter. I will still post ideas on my
  stocktwits" — 2021-02-05). Grew from ~1k followers (2021) to ~350k+ (2026), ~500M+
  impressions/yr.
- Not a professional: "trading is a passion but only hobby. Not my career" (2025-02-24);
  self-employed business owner; "I'm just your average trader… Trading is not even my full
  time job. Just a side hustle" (2024-08-02).
- Monetization: free content, **no** subs/discord ("I want to lose in peace" — 2025-08-06);
  X ad revenue (~$300–700/check, often given away in contests), Buy Me a Coffee/tips,
  a WOLF Financial sponsorship (from ~Oct 2025), a $1 X-subscription that is explicitly
  just a badge.
- Trades through thinkorswim/TDA → Charles Schwab; screens with **Finviz**; charts manually:
  "Thinkorswim. It's all manual per my eyes. I don't have a filter tbh" (2021-05-24).

## 2. The headline finding for this repo

The question that motivated this research — "what is his volume-shelf strategy?" — has a
negative answer, verified two independent ways:

1. **Corpus scan**: 0 hits for volume-profile vocabulary in 64,865 tweets (the only
   HVN/LVN string matches are random substrings inside `pic.twitter.com` URLs).
2. **Adversarial web-research pass**: every "volume shelf" / "break-even supply/demand"
   definition on the web traces to third parties (TrendSpider, Precision Volume Alerts,
   Market Rebellion) whose material never mentions him. 23 of 25 verified claims about him
   concern gap fills, VIX statistics, share/premium execution and sizing — none concern
   volume profile.

That said, several of his concepts are **functional cousins** of volume-profile ideas,
which is probably why the association exists (see §12 for the mapping to this app):

| His concept (price-based) | Volume-profile cousin (this repo) |
|---|---|
| "Gaps get filled 80% of the times… use it as a magnet or price target" | Volume gap / LVN traverse |
| "When a stock roundtrips its entire recent big up move, it usually finds support at that prior breakout point" | Break-even demand shelf |
| "Prior highs always act as resistance" | Break-even supply shelf |
| Round-number "self-fulfilling prophecy" magnets | High-volume node / POC magnet |

## 3. Core philosophy

- **Mean reversion first.** "Stocks don't go up or down in a straight line forever"
  (2021-12-07). The default trade is an oversold bounce or an overbought fade, *not* trend
  following or breakout chasing.
- **Contrarian at extremes.** "Buy when blood/fear in the streets" (2021-07-27); "any time
  [CNN Fear/Greed] is in maximum fear or greed, tends to mark an interim bottom or top"
  (2022-04-10); "The 'everyone is on one side of the boat' analogy" (2021-07-18).
- **~50% hit rate, openly.** "I bat .500… it's about risk management. Some luck too. Live
  to fight another day" (2021-08-20); "your winning % will be slightly over 50% on
  average. It's how you manage risk & the sizing of your position that matters. Let your
  winners run, and cut your losers" (2021-10-15).
- **Survival doctrine.** "Just survive. Live to fight another day" (recurring 2021→2026);
  "a -84% drop means you will need a +525% return to get back to breakeven" (2026-03-28).
- **Explicit anti-precision.** His stated signal generator is the "**GIG indicator**:
  guessing, intuition, guts" (2024-05-28) — he frames the charts as probabilistic
  ("works 80% of the times" is his signature hit-rate tag) and himself as entertainment
  plus education, not a guru: "Tail, fade, or ignore. Kthxbye" (2024-10-30).
- **Never-delete transparency.** "I never delete my receipts… I don't sell subs. Because I
  like to be wrong in peace" (2025-05-16); periodically posts his own losing calls
  unprompted (2024-12-12, 2024-12-18).

## 4. The playbook — his recurring setups

Each setup below is his, in his words. Typical expected move for bounce-class trades is
**5–15%** on the underlying ("Looking for just a 10-15% pop initially").

### 4.1 Oversold bounce / "dead cat bounce" (his bread and butter)
- **Trigger stack** (2–4 of): down **N days in a row** ("$SQ now down 11 days in a row.
  Due for a green day" — 2022-01-27); **daily RSI < 30** (extreme < 20) with historical
  analog stats ("The last 4 times the daily RSI has been this oversold, the stock rallied
  76%, 18%, 21%, and 50% respectively. We are due!" — $SOFI 2021-07-08); big % drop
  peak-to-trough; sitting at a support confluence (50/200dma + trendline + gap + round
  number); candle completely outside the lower Bollinger Band.
- **Confirmation**: hammer / red-to-green reversal ("look for an intraday bounce with a
  red open to green close. We want to see a hammer candlestick on the daily" — 2021-07-19);
  premarket above prior day's high.
- **Explicitly not a bottom call**: "due for a dead cat and only a dead cat bounce here"
  (2021-02-05, his first archived trading tweet, on $GME at the 50dma).
- **Falling-knife variant** (steeper, riskier, smaller size): "$LMT -Down 9 days in a row.
  -Sitting right near the 200dma. -Retesting prior resistance turned support breakout
  point. -Daily RSI one of the lowest ever… Time to buy for a bounce? I think so"
  (2026-04-26). Sizing: "Toss a Subway sandwich at it. Not even the 12 inch variety, but
  the 6 inch" (2025-09-10).

### 4.2 Gap-fill plays (price gaps, his #1 target tool)
- **Doctrine** — his unifying statement (2021-12-19): "The market is dynamic. The ultimate
  'Matrix' program… However there's 2 things I learned over the yrs to get ahead the
  system: $VIX fills their gaps 100% of the times eventually. Gaps on stocks/etf's fill
  80% of the times eventually." Restated for years: "Gaps get filled 80%+ of the times,
  eventually. Use it as a magnet or price target" (2022-06-10).
- **Intraday gap fade ritual** ("DARING SOULS"): "high probability plays everyday: Big gap
  down at open: buy it for a trade. Big gap up at open: short it for a trade. Period"
  (2022-07-12). Posted dozens of times as "Who will be the DARING SOULS to fade this
  huuuuuge gap up for some intraday gap fill attempt? Raise your mf'in hands. 🙋🏽🙋‍♀️🙋🏻‍♂️".
- **Swing gap targets**: level maps of unfilled gaps, e.g. "$TSLA next notable price
  targets: 233.94 240.45 248.42 Not voodoo magic. Just gap fill magnets. 🧲" (2024-07-03);
  his April-2023 pinned tweet was literally a list of six unfilled $SPY gaps.

### 4.3 Roundtrip / prior-breakout support
- "Pro Tip: when a stock roundtrips its entire recent big up move, it usually finds support
  at that prior breakout point. Play those for a cheap quicky 5-10% bounces. Works about
  80% of the times. Yes the other 20% it just slices right through" (2022-01-07).
- Resistance-turned-support flips: "It's called resistance turned support. It's fairly
  obvious actually" (2025-02-22).

### 4.4 Moving-average confluence (50dma / 200dma)
- "50 and 200 day moving averages always ALWAYS act as magnets" (2022-07-19).
- Long at the touch with confluences: "$XLE you buy… Right at the 200dma. Right at the 50%
  retrace fib lvl… BUY" (2024-06-20).
- Short the failed test: "$SPY hit 200dma but failed to breakout… Obvious play: stay
  short, stop loss at the 200dma. Bank it" (2022-08-21).

### 4.5 Trendlines and the MOAT
- **MOAT = "Mother of All Trendlines"**, his coined brand (claims coinage 2025-02-25):
  a multi-year trendline with 3+ touches (his definition on Threads, 2025-01-13: "a
  trendline of a prolonged period of time (12months+) AND it has at least 3 touches").
  Variants: BOAT, COAT, mini MOAT, "Grand Mother of all MOATs", MECH ("Most Epic Channel
  in History").
- Traded both ways as a binary level: "Upside target if MOAT breaks convincingly: 418.49
  gapfill. Downside target if MOAT holds convincingly: 372.42 gapfill" (2023-01-14).
- "The more tests, the higher…" odds of a break (2024-11-27).

### 4.6 Pattern breakouts with measured moves
- Toolkit patterns: bull/bear flags, pennants, rising/falling wedges, triangles, double/triple
  tops-bottoms, H&S and inverse H&S, cup-and-handle. Entry qualifier is always a
  "**convincing** break above/below."
- Measured-move targets "by the book": "If this bear flag is true, then the 'by the book'
  measured move is roughly down to 5,150ish" (2025-03-31).
- Failed-breakout awareness: "Just because a name breaks towards ATH's does not mean sky is
  clear" (2021-08-17); the too-obvious check: "It's too clean, too textbook… is it so
  obvious that it makes it not obvious anymore?" (2025-03-27).

### 4.7 Coiled-spring volatility plays
- Trigger: ultra-tight Bollinger Bands / narrowing range. Play: **strangle/straddle — don't
  pick direction**. "A 90% sure play. Strangle TSLA. It's coiling so hard for a big move…
  Don't guess the direction. Just play the volatility" (2024-06-07).

### 4.8 Earnings plays
- **Structure of choice: sell the IV**, not buy it. "For earnings plays there are a
  multitude ways of coming out with a profit… Commons, Commons + CC's, CSP's, PCS's. Not as
  sexy I know" (2025-02-04). "The best theta and vega destroyer are earnings the Thursday
  after hrs before Friday expirations. Option writers win again" (2025-02-13).
- **The 3-day rule**: "Always wait 3 days after a harsh er drop" (2021-10-21; repeated
  2022, 2024, 2025, 2026).
- **Fade the run-up / buy the weakness into ER**: "when you get a big run up into earnings,
  it will sell off after. And vice versa" (2021-08-18).
- Implied-move arithmetic: "Take 80-85% of the atm straddle of the weeklies" (2024-11-04).

### 4.9 Pair trades (relative-value mean reversion)
- Trigger is a relative-performance extreme ("the jaws are widening"): "Nordstrom has not
  been this oversold relative to Macys in over 2 years. Time for mean reversion... Buy JWN
  and short M" (2021-08-25); "Long $IWM Short $QQQ" (2024-07-24); "I LOVE PAIR TRADES"
  (2022-06-17).

### 4.10 Short-side playbook
- **Triggers**: parabolic "too far too fast" moves (blow-off tops with 2–3 consecutive gap
  opens and a crescendo candle — his definition 2024-06-21), failed 200dma tests, bear
  flags, RSI > 70–80, up-N-days-in-a-row streaks, extreme distance above the 200dma
  (Finviz screen).
- **Rules**: "don't short into weakness, rather short into strength" (2022-03-14); "You
  don't ever short anything with size… Subway sandwich amounts only. So 2-5% of your
  total…" (2026-04-25); don't overstay ("dead cat bounces can be just as violent" —
  2021-10-07); never short meme stocks without tight stops — "Buy puts instead if u must"
  (2021-08-30); never short into an elevated VIX ("Where were you 7-10% ago?!").
- **Favorite structural short**: parabolic spikes in VIX ETPs and levered ETFs, playing
  the decay — "any super parabolic spikes in these vix etn's/etf's should be shorted…
  Never fails" (2021-09-29); "These 2x-3x bear etf's when they go super parabolic, it's a
  good short if timed right. Could utilize the daily reset/decay to your advantage"
  (2025-03-13). He also tells the cautionary tale of his own 2017 $XIV short (2026-04-25).
- Self-positioning: "I'm not a bear, I'm just a realistic bull" (2024-07-11); "most of my
  money ever was made longing and not shorting" (2026-03-12).

### 4.11 Screens that source candidates
- **"Down/up N days in a row" streak counting** (manual, his signature).
- **Finviz extremes**: "top 7 most overbought names… price greater than 100% above the 200
  day moving average" (2025-02-15, and the follow-up victory lap 2025-02-24 when they all
  fell 17–34%); RSI < 20 lists as a "shopping menu" (2025-04-08).
- **Insider buys — "Tail the Whale"**: "Tail the whales when they buy. Bail with the whales
  when they sell. Ez" (2022-02-17); also tails named pickers on a hot hand (Eric Jackson →
  $OPEN: "you ride the hot hand" — 2025-07-16).
- **Short interest / float** for squeeze candidates: "The secret ingredients to a gamma
  squeeze: low floater, high short %, optionable, wsb pump" (2021-08-27).
- **Earnings calendar**, index-inclusion events, stock splits, sympathy/halo plays
  ("NVDA is obviously the 12oz filet mignon steak. The rest of the names are like salt and
  pepper" — 2024-06-06), and his own X newsfeed as a momentum radar.

### 4.12 Lotto tier
- Far-OTM strangles/0DTE for "**subway sandwich amounts**" only — his named unit for
  gamble money, explicitly ≤ 0.1% of account ("Do you have $200 to just gamble away? If
  it's like less than .1% of your account value, then you sure do" — 2024-06-02). He mocks
  0DTE culture constantly and lists "FAR OTM Weekly Options" as the #10 reason traders
  fail (2024-06-23).

### 4.13 Event-day and catalyst playbook
- **FOMC/CPI days = unpredictable chop; the edge is writing options, not direction.**
  "Close as flat as flat can be on FOMC day. Wow. F your calls and puts lol. Unless you
  wrote options…" (2025-06-18). His standing CPI joke: "C - Can't P - Predict I -
  Inflation" (recurring 2024→2026). Fade the initial FOMC move (§8).
- **Implied-move ritual**: posts the weekly implied move before every big ER/event ("Take
  80-85% of the atm straddle of the weeklies and there ya go" — 2024-11-04) and picks the
  structure off it — a big implied move means *sell* puts, don't buy calls: "$META -1.75%
  in premarket. The proper play was to sell puts given the implied was almost 8%"
  (2024-10-31). "$NVDA earnings… should be treated like an FOMC day" (2024-05-19).
- **Buy-the-rumor / sell-the-news** as a distinct setup class: "$SPCE i called the 'buy
  the rumor sell the news' upon Branson's successful space flight. Now I am calling for a
  'sell the rumor buy the news' inverse event on Bezos" (2021-07-17); "$GME … running up
  into the live stream. Then I would NOT be surprised we get a selloff on a 'buy the rumor
  sell the news' event after he signs off" (2024-06-07); rhymed rule: "If stock keeps
  drippin', you buy the dippin'. If stock has a rocket fuse, you sell the news" (2024-10-03).
- **Seasonality roadmaps** published as explicit annual paths: "mini treacherous September
  overall and potentially bottoming in October. A peak to trough move of no greater than
  -7%ish… Nov and Dec we get that usual Santa Claus" (2024-08-29); "The last 5 Octobers
  marked an interim bottom before a 12% average rally to finish the year" (2024-09-21) —
  with reflexivity self-awareness: "Since everyone knows the $SPX is seasonally weak in
  September, then it won't happen. Cause markets won't do what everyone knows it will do.
  But since everyone knows that everyone knows…" (2024-09-02).

### 4.14 Crypto playbook (BTC/ETH only, charted like stocks)
- **Weekend crypto as the stock-futures tell** — one of his longest-running heuristics:
  "crypto weekend movement is usually a forecast of how the stock market will open. Risk
  on or risk off" (2021-02-07); "Crypto up = stocks risk on. Crypto down = stocks risk
  off" (2022-05-14); still in 2026: "There has got to be a better way to have some kind of
  stock weekend futures/indication than Weekend IG, Crypto markets, and Hyperliquid"
  (2026-03-01).
- **4-year-cycle macro frame**: "$BTC goes through a predictable 4 year cycle of boom and
  then bust and then reboom. Every. Single. Time." (2026-02-11), with day-count analogs
  for ATH recapture (2026-02-24).
- **Same TA toolkit**: level sequences ("BTC needs to hold $90k ish like a champ, break
  through $93k, then valhalla towards $100k" — 2025-11-30), dead-cat frame, 200dma
  trampolines, round-number magnets ($80k/$100k), coil detection; $MSTR/$COIN/$IBIT as
  equity proxies. Majors only: "I would never buy any crypto outside bitcoin/eth"
  (2022-05-14). And the notable exception to his stop-loss creed: "Is it safe to say that
  you should NOT set stop losses on crypto? … SWOOSHED. Then reverse swooshed in a matter
  of several hrs" (2025-02-03).

## 5. Exits, stops, targets

- **Stop placement**, always at a structural level: just beyond round numbers ("Buy to
  1,050. Stop loss 1,000ish" — 2024-05-23), at the prior breakout point ("stop loss 300" on
  $MSFT's 300 breakout — 2022-01-18), at the 50/200dma ("stay short, stop loss at the
  200dma"), "tight stop" for day trades. Mental stops + GTC sell at target for shares.
  Trailing stops into strength ("Scale up your stop loss trails" — 2024-11-12). One
  exception he muses on: crypto's stop-hunt wicks (2025-02-03).
- **Doctrine**: "Stop losses are you friend" (2022-01-14); #1 reason traders fail = "No
  Stop Loss" (2024-06-23).
- **Targets** are always pre-stated levels: gap fills > round-number magnets > moving
  averages > prior highs > measured moves — usually a *sequence* ("break 28 → test the
  28.6 50dma → 30 psychological → 31.80 gapfill. That's my playbook" — 2021-03-11).
- **Profit-taking creed**: "No one ever went broke with a profit, however big or small"
  (2021-08-20, repeated for years); sell into strength at resistance; scale out; the hybrid
  rule "You can always unload half or 3/4 of it, but have a little exposure in case your
  original thesis plays out" (2026-03-10); "house money" free-rolls.
- **Indicator-based dials**: "Buy stocks when Daily RSI is below 30. Buy aggressively below
  20. Sell stocks when Daily RSI is above 70. Sell aggressively above 80. Period"
  (2022-06-23).
- **Losses**: cut small and move on ("Taking my L and moving on" — 2021-09-15) — but he
  openly averages down on conviction holds and admits bagholding (WISH −$95–100k in 2021,
  bagholding shorts in 2022). The discipline is aspirational and human, not mechanical.
- **Options exits**: close credit spreads early once 90–99% of the credit is captured
  ("Don't care for that $26 bucks or so to find out" — 2024-06-27).

## 6. The options execution layer

- **Identity: premium seller.** "I am an option seller mostly. And long and short commons.
  I hardly play calls and puts outright long" (2026-03-26). "CSP = cash secure puts, PCS =
  put credit spreads. My bread and butters" (2026-03-12). This goes back to 2021: "i am a
  put seller primarily… I am not one to yolo calls" (2021-08-12).
- **Mechanics**: sells weeklies-to-3-weeks at **0.15–0.30 delta** ("I'm all about selling
  weeklies with .15-.30 deltas. Seems less stressful" — 2026-01-21); sells calls on green
  days, puts on red days (2021-07-01); wheels assignments ("If I get assigned, I get
  assigned… wheel strat it" — recurring); sells into high IV ("If IV high, then sell
  options" — 2021-10-24; "An elevated $VIX especially one nearing 30 is usually a great
  time to write options" — 2025-10-17).
- **Buys** options only as: LEAPS on deeply oversold conviction names ("$META leaps and
  chill. Come back to me in 12 months" — 2026-03-27), strangles on coils, hedging puts,
  and subway-sandwich lottos.
- **Honest about the downside**: "you get assigned, now you have shares at well under your
  basis and you either close for a loss or baghold or wheel it until breakeven which can
  take…" (2024-12-21); "picking up pennies in front of a steamroller" (2025-02-25, of
  himself).

## 7. Risk management and sizing

- **Small speculative unit**: "subway sandwich amounts" ≈ gamble money ≤ 0.1% of the
  account; shorts capped at "2-5% of your total" port (2026-04-25); ordinary positions
  ~1.5% ("Only 1.5% of my portfolio. No biggie" — 2026-02-09).
- **The $100k journal's stated rule** (verified verbatim from the Jan 8 2024 long-form
  announcement): 1–10% of the account per position tiered by confidence — "1st level:
  1-3%, 2nd level: 4-6%, 3rd level (ultra confident): 7-10%" — horizon "anywhere between
  1yr - 5yrs", explicitly "no get rich quick, 0dte, all in, try to 10x in 3 weeks."
  In practice the journal's credit spreads risked ~0.7–2.5% each; its largest position
  (a contrarian long-VIX call bet) reached ~13% of the account.
- **Portfolio hedging**: 15–20% of the book in hedges in 2021 ("long $VXX, short $SVXY,
  short $TNA, short $QQQ via options. I keep about 15-20% of my portfolio in these" —
  2021-02-28); VIX calls / SPY puts / covered calls when VIX is depressed ("$VIX with a 13
  handle seems cheap. For insurance purposes. Buy" — 2024-11-14); "deleverage, protect,
  hedge, sell on strength, have plenty of dry ammo" at euphoric extremes (2025-01-15).
- **Cash is a position**: "You sit on your hands and wait for that golden opportunity to
  buy low when there is maximum fear" (2022-06-13).
- **No margin** for himself ("I don't play on margin" — 2021-03-25); levered ETFs only
  after crashes, never at highs (2025-10-04).
- **The 10 reasons traders fail** (2024-06-23): "1. No Stop Loss 2. Emotional Trading
  3. FOMO 4. Trying To Follow Others 5. Overtrading 6. No Risk Management 7. Looking For
  Home Runs 8. Wants To Get Rich Overnight 🚨 THE BIGGEST 1 9. Position Sizes To Large
  10. FAR OTM Weekly Options".

## 8. The VIX / regime framework (his market-timing layer)

- **The two rules**: "Buy stocks when vix is elevated. Sell stocks when vix is depressed.
  Works. Every. Friggin'. Time" (2021-10-26). Calibrated: nibble at VIX 20+, "hammer the
  buy button" at 25–30, "go all in when VIX is at 40+"; trim near 20, "selling hands over
  fist" at 15–19 (2022-08-14). Re-based upward in bear markets (buy 35–40, sell sub-20 —
  2022-03-12).
- **VIX gap fills**: "The VIX historically fills all its gaps 100% of the times"
  (2021-02-16 → 2026-03-30, unbroken doctrine). Used to time both vol trades and equity
  entries ("Once it fills, I want you BTFD'ers to slam that buy button" — 2022-04-25).
- **"VIX Crush Fridays ™"**: VIX red on Fridays ~80% of the time; he keeps a public W-L
  record ("Ytd record so far 4-1… I just simply keep track of whether the VIX is red or
  green on Fridays. That's all" — 2025-02-07).
- **Short vol spikes**: his highest-conviction recurring trade — "wait for any large spikes
  and short the bejeezus out of these… average in increments… it's a 99% win rate in the
  long run" (2021-07-26); called live at Yenmageddon 2024 (VIX 66) and the April-2025
  tariff crash (VIX 60): "There will be a generational opportunity to short the $VIX"
  (2025-04-07).
- **Long vol at complacency**: "Insurance is cheap here around high 12's and low 13's"
  (2024-12-05); "It's very hard to time a VIX spike ngl. It's actually much easier to
  short the VIX on those spikes" (2025-02-17).
- **Seasonality stats** (posted as "🚨 Heisenberg Observation 🚨"): VIX spikes July–October
  ("14 of the last 16 years or a 88% probability rate" — 2024-07-20); September weakness /
  Santa rally; day-of-week streaks; CPI/FOMC day patterns ("do the opposite of the initial
  pop or drop reaction of FOMC" — 2022-05-04); "Futes: You buy eod or in after hrs and sell
  pre market or by open next trading day. Works 80% of the times" (2024-07-21).
- **Regime shifts he trades**: 2022 = "sell the rip environment until further notice"
  with bear-market-rally longs; 2024–25 bull = "BTFD all day everyday until it doesn't
  work. Newsflash: it ALWAYS works" (2024-10-24); a simple binary regime line when needed
  ("stay short if below 384. Get long once it breaks above 384 convincingly" — 2022-06-16).

## 9. The $100k journal account (@Heisenberg_100k) — his strategy in captivity

A free public trade journal ("A free public trading journal started on 2-20-24 with $100k
to see how far we can take this account to. No timetable. Just enjoy the ride." — account
bio). Announced 2024-01-08 on the main account with the confidence-tier sizing rules
(§7). Broker: Schwab (ex-TDA). Every trade posted as `$TICKER Open/Closed | In X | Out Y |
+Z% | +$P&L` with screenshots.

**What the record shows** (all 275 archived journal tweets reconstructed, ~60 documented
trades):

- The engine was **short premium**: dozens of small credit-spread wins of +$130…+$1,080
  each (SPY/QQQ/SPX index spreads risking ~$2.5–5k, single names ~$0.7–2.2k), 15–25
  delta, closed early at 90-99% of credit.
- The losses were mostly **bought options**: IWM calls −$1,900 (−100%), RSP calls −$1,300,
  CABA −$1,095 (−23%), FXI calls −$495, and the final documented loss — QQQ put spread
  −$2,740 on 2025-03-10: "Crazy day. Spread from Friday dead. Did not anticipate this
  Black Monday."
- Notable non-spread trades: the contrarian long-VIX call campaign (May 2024, pressed to
  50 contracts @ 2.98 avg ≈ 13% of the account, half closed +12.5%, rest rolled into a
  12.5/21 call debit spread, final outcome never posted); binary "why not" plays (PTON
  241-DTE calls +11%); falling-knife catches (PZZA, U); earnings IV-crush plays (NVDA, MU,
  AAPL, HOOD).
- **Account trajectory as posted**: $100k (Feb 2024) → $116,821 (2024-06-27) → $118.5k
  (2024-09-12) → $118k all-cash (2025-01-04) → no balance ever posted after the March-2025
  loss. **≈ +18% in ~10.5 months**, then silence.
- **The end**: "Obviously I stopped my $100k challenge. Just couldn't find the time to
  manage my main trading account and the $100k port" (2026-03-26). The account is now
  protected. Transparency was good but imperfect: ~15 documented opens have no posted
  close; one loss was recorded only as "RIP".

## 10. Glossary — his named concepts

| Term | Meaning (operational) |
|---|---|
| **MOAT / BOAT / COAT / MECH** | Mother of All Trendlines — multi-year, 3+-touch trendline traded as a binary level; siblings = shorter trendlines/channels |
| **VIX Crush Fridays ™ (VCF)** | VIX tends red on Fridays (~80%); tracked as a public W-L record |
| **DARING SOULS** | the intraday gap-fade ritual (short big gap-ups / buy big gap-downs for the fill) |
| **🚨 Heisenberg Observation 🚨** | branded historical-analog stat post ("Extrapolate how you see fit") |
| **GIG indicator** | "guessing, intuition, guts" — his self-deprecating label for discretion |
| **Subway sandwich** | tiny gamble-sized position (≤0.1% of account) |
| **Tail the Whale** | copy large insider buys (bail when they sell) |
| **3-day rule** | wait 3 days after a harsh earnings drop before buying |
| **Dead cat (💀🐱🏀)** | oversold bounce trade, explicitly not a bottom call |
| **Gap fill magnets 🧲** | unfilled price gaps as price targets (80% stocks / "100%" VIX) |
| **Pressed** | added to a winning/conviction position (journal vocab) |
| **Why not.** | the entire risk case for a lotto play, in two words |
| **All you can eat** | a no-brainer accumulation zone (usually retrospective) |
| **Hammer/smash the buy button** vs **nibble** | full-size entry at a level vs small scale-in |
| **On deck** | next target in the level sequence |
| **Jay Pow Wow** | Powell; FOMC rule = fade the initial move |
| **Turnaround Tuesday / Black Monday / Yenmageddon** | day-of-week reversal hope / weekend-panic label (he buys it) / the Aug-2024 yen-carry crash |
| **Inverse Heisenberg ™** | self-jinx ritual (buys the opposite to force the move) |
| **Triple top of doom** | 3-touch major resistance |
| **Pin job** | opex pin at a round number |
| **Tontards / fam** | his audience (PSTH-era → general) |
| **I bat .500** | his standing win-rate claim |
| **PoTM** | Pick of the Month — public monthly pick with checklist + explicit time window (e.g. 30 trading days), tracked win-or-lose |

## 11. Track record and caveats (read before cloning any of this)

- **Self-reported ~50% accuracy** is the only rate available; there is no audited record.
  The journal's ≈+18%/10.5 months is the closest verifiable stretch — decent but modest,
  achieved during a strong bull tape, and it ended with an unexplained gap after a loss.
- His signature probabilities ("works 80% of the times", "VIX gaps fill 100%") are folk
  statistics he asserts, not backtests. Some have real statistical basis (gap-fill rates
  and VIX mean reversion are studied phenomena); the numbers themselves are vibes.
- Survivorship shows up exactly where he says it does: "You guys see me retweet my right
  calls. Giving the illusion I'm always right" (2024-12-18).
- Selling 15–30-delta premium has a natural high win rate with fat left tails — his own
  words: "picking up pennies in front of a steamroller." The journal's biggest hit was
  precisely a tail day (2025-03-10).
- He is explicit that none of it is advice and that he's "an average trader that likes to
  draw squiggly lines on a chart" (2026-01-12). The persona (humor, memes, rituals) is at
  least half the product.

**Preached vs. practiced — contradictions the corpus itself documents:**

| He preaches | He practices |
|---|---|
| "Stop losses are you friend"; #1 failure = no stop loss | Mostly *mental*/level-based stops ("Mental stop loss. But u are right" — 2021-10-05); no stops at all on crypto (2025-02-03); held $CEI "for dear life" |
| "Cut your losses on crap" | Openly averages down and bagholds on conviction names (WISH −$95k, PSTH warrants, 2022 shorts: "now bagholding my shorts. Gulp") |
| "I RARELY yolo calls" (2021-10-26) | A steady stream of documented "yolo" calls/puts 2021→2026 (always small, but frequent); ~half the journal's documented trades were long options |
| Fixed VIX buy/sell thresholds (20/30) | Thresholds get re-based by regime: buy 35–40 in the 2022 bear (2022-03-12), and he mocks shorting VIX 50–60 panics (2025-04-08) |
| "I bat .500" (standing claim) | "Whenever I say trust me bro, my hit rate is actually better than 50%" (2026-01-28) |
| 2021 self-description: put seller who "rarely buy[s] commons or leaps" (2021-08-12) | 2026 self-description: "I do mostly commons and write options… I rarely buy options" (2026-01-21) — the mix flipped commons-heavy over five years |

## 12. What this means for VolumeShelfs

His method and this app's method are **different frameworks that often point at the same
levels**. If the goal is "trade like Mr_Derivatives", the app already covers some of it
and could add the rest as playbooks:

**Already aligned:**
- *Volume gaps as magnets* ≈ his price-gap-fill targets (different derivation, same trade:
  fast traverse to the far side).
- *Break-even demand shelf below price* ≈ his prior-breakout-point support ("roundtrip"
  play) — the app's mechanism (holders at break-even stop selling) is literally the
  textbook explanation for why his prior-breakout level holds.
- *Regime filter (200-day)* ≈ his 200dma magnet/failed-test logic and his binary regime
  lines.
- *Discipline guard* ≈ his sizing/heat/stop sermons (the app's 1–2% risk cap is stricter
  than his 1–10% confidence tiers).

**Candidate additions (his edge-cases the app doesn't model):**
1. **N-days-down/up streak + RSI-extreme bounce screen** — his single most-used entry
   trigger; trivially computable and backtestable in the existing scanner.
2. **Gap-fill playbook on price gaps** (not just volume gaps): catalog unfilled gaps,
   distance-ranked, with the intraday-fade variant on >1% opening gaps.
3. **VIX regime dial** as a scanner gate: nibble/hammer/trim/sell bands (20/25-30/40+ vs
   15-19), plus "don't short when VIX > 30" and "don't buy fresh highs when VIX < 15".
4. **Confluence counter**: his entries are always 2–4 stacked supports (MA + trendline +
   gap + round number + RSI). The app's shelf/AVWAP confluence ("pinch") logic could
   ingest round numbers and gap edges as additional confluence sources.
5. **3-day earnings rule** and **implied-move context** for any candidate with an
   imminent/recent ER.
6. **Round-number magnets** as first-class levels alongside shelves.

*(Each of these is a hypothesis to backtest with the app's existing IS/OOS ablation
harness — his "works 80% of the time" numbers should be treated as unverified marketing
until the data says otherwise.)*

## 13. Method & sources appendix

**Corpus**: 65,480 unique archived tweet URLs enumerated via the Wayback Machine CDX API
(`twitter.com/Mr_Derivatives/status/*` + `x.com/...`); 64,865 texts recovered via X's
public oEmbed endpoint (`publish.x.com/oembed`). ~600 tweets unrecoverable (deleted /
protected / 404). Coverage is dense for 2021-02→2022-09 and 2024-05→2026-07, thin for
2022-10→2024-04 (Wayback archiving gap, ~200 tweets for all of 2023) — so 2023-era
behavior is under-sampled. Long tweets are truncated by oEmbed at ~280 chars (marked "…").
oEmbed strips images: his chart annotations (the richest part of many posts) are not
analyzed here.

**Journal corpus**: 275 tweets of @Heisenberg_100k recovered from Wayback-archived Twitter
API v2 JSON captures (the account is now protected; May 2024 – Apr 2026 coverage, the
founding rules tweet of Feb 2024 was not archived).

**Analysis**: a 10-dimension close-reading workflow (11 agents) read the corpus per theme
(setups, exits, sizing, options, VIX/regime, journal, vocabulary, scanning, track record,
evolution) plus a completeness critic whose gap-fills (event-day playbook, crypto
dimension, preached-vs-practiced contradictions) are folded in above.

**Verification**: a 5-angle web-research workflow (98 agents) extracted 66 claims from 16
sources and adversarially verified the top 25 with 3-vote panels: 23 confirmed, 2 refuted
(both about volume-shelf lineage, not about him). Key verified primary tweets:
`1744428891195003101` (journal rules, 2024-01-08), `2032147761475568034` (90%
shares+writing options, 2026-03-12), the Apr-2023 pinned SPY gap list, and the 2023-02-08
VIX/50dma thread.

**Corpus term counts** (tweets matching, case-insensitive): options/calls/puts 2,371 ·
bounce 2,238 · VIX 1,580 · moving averages 1,383 · gaps 1,120 · earnings 1,052 ·
support/resistance 998 · contrarian/sentiment 703 · RSI 629 · trendline/MOAT 367 ·
stop-loss 336 · dead cat 249 · **volume shelf/profile/AVWAP/air-pocket 0**.

**Top tickers**: SPY 2,594 · SPX 2,467 · QQQ 2,283 · VIX 1,476 · TSLA 1,431 · NVDA 1,356 ·
IWM 965 · AAPL 896 · PLTR 773 · BTC 770 · PSTH 713 (2021 era) · META 709 · BABA 576 ·
GME 463 · … (indices + Mag7 + meme/China/crypto rotation by era).

**External sources consulted**: x.com/Mr_Derivatives (profile, via archives),
threadreaderapp unrolls, threads.com/@mr_derivatives, Wayback profile captures
(2023-04-12, 2023-06-03, 2025-11-04), buymeacoffee.com/mr_derivatives, plus third-party
volume-shelf material (TrendSpider, Precision Volume Alerts, Market Rebellion) used only
to establish that the volume-shelf school is *not* his.
