/**
 * Plain-English glossary shown in the in-app Guide and as badge tooltips.
 * Written for a complete beginner; wording is code-verified to match how the
 * engine actually computes each concept (see src/core/*).
 */
export interface GlossaryEntry {
  id: string;
  term: string;
  /** One-line tooltip. */
  short: string;
  /** A short plain-English explanation. */
  plain: string;
  /** Why it matters for a trade. */
  why: string;
}

export const GLOSSARY: GlossaryEntry[] = [
  {
    id: "anchored-volume-profile",
    term: "Anchored Volume Profile",
    short: "A sideways bar chart of how much traded at each price, from a start bar you pick.",
    plain:
      "A volume profile is a sideways bar chart that shows how many shares traded at each price level, instead of over time. 'Anchored' means it only counts trading from a start bar you choose (like a big high or low) up to today. In this app it takes every candle from the anchor to now, splits the price range into 50 rows, and spreads each candle's volume across the rows it covers. The result shows exactly where lots of trading happened and where almost none did.",
    why: "It tells you which price levels are real walls versus thin air, which is the whole basis for the entry, stop, and target.",
  },
  {
    id: "anchor",
    term: "Anchor point",
    short: "The meaningful start bar you pin the profile to; it decides the whole story.",
    plain:
      "The anchor is the single bar where the profile starts counting volume, usually a major swing high, a swing low, the year's open, or an earnings date. Everything before it is ignored, so the picture depends entirely on where you anchor. This app picks the anchor automatically, choosing the significant high or low whose profile best explains where price is trading now. Move the anchor and the shelves, gaps, and fair price can all shift.",
    why: "Where you anchor decides which levels show up, so a good anchor is the difference between a real setup and a mirage.",
  },
  {
    id: "volume-shelf",
    term: "Volume shelf (HVN)",
    short: "A price zone where tons of shares traded, so it acts like a wall.",
    plain:
      "A volume shelf, also called a High-Volume Node (HVN), is a run of neighboring price rows that each traded well above the average row (in this app, at least 1.5 times the average, with two or more rows in a row). Because so many shares changed hands there, lots of people care about that price, so it tends to stop price like a floor or a ceiling. A shelf below the current price acts as support (buyers who bought there stop selling). A shelf above price acts as resistance (people stuck up there sell to escape).",
    why: "Shelves are where you enter and set your stop, because price is far more likely to hold or reverse at a wall than in empty space.",
  },
  {
    id: "volume-gap",
    term: "Volume gap (LVN / air pocket)",
    short: "A price zone where almost nothing traded, so price races through it.",
    plain:
      "A volume gap, also called a Low-Volume Node (LVN) or 'air pocket', is a thin band where very little traded. The app finds it the way Wujastyk reads a chart: a valley between two volume shelves whose floor dips well below the shelves that wall it in (to at most 40% of the smaller neighbouring shelf), not just a fixed percentage of the single busiest row. That relative view matters — a real gap can sit between two mid-height shelves while a distant, much fatter shelf owns the POC and makes the area look 'busy'. Because barely anyone traded there, few holders slow price down, so it travels through fast. Edge-of-profile thin tails are ignored.",
    why: "The fast travel through a gap is where the quick reward comes from, and its far edge often becomes your target.",
  },
  {
    id: "poc",
    term: "POC (Point of Control)",
    short: "The single price where the most shares traded, a magnet for fair value.",
    plain:
      "The POC, or Point of Control, is the one price row with the highest volume in the whole profile. Because more trading happened there than anywhere else, the market has broadly agreed it is a fair price, so price tends to get pulled back toward it. In this app the POC is found by scanning every row and keeping the busiest one, and it also serves as the center that the Value Area grows out from.",
    why: "If the POC sits above the current price it warns of overhead supply, and it often acts as the first target on the way up.",
  },
  {
    id: "value-area",
    term: "Value Area (VAH / VAL)",
    short: "The price band around the POC that holds about 70% of all the volume.",
    plain:
      "The Value Area is the range of prices where most of the action happened, about 70% of all the volume in this app. It starts at the POC and grows outward one row at a time, always adding whichever neighboring row has more volume, until it captures that 70%. The top edge is the VAH (Value Area High) and the bottom edge is the VAL (Value Area Low). Prices inside this band are considered accepted, while prices outside it are where the market spent little time.",
    why: "A shelf inside the Value Area is a stronger, more trusted level, and the VAH/VAL edges make natural targets and support lines.",
  },
  {
    id: "break-even-demand",
    term: "Break-even demand",
    short: "A volume shelf below the current price that tends to act as support (a floor).",
    plain:
      "A volume shelf is a price band where a lot of shares changed hands, so it acts like a wall. When such a shelf sits below today's price, the app labels it break-even demand. The idea: people who bought down there are now back to about break-even, so they stop panic-selling, and fresh buyers step in near that price, which tends to hold price up like a floor. In the code, classifyZone() tags a shelf 'break-even-demand' whenever the current price is at or above the shelf's top edge, and the app picks the closest one below price as the nearest demand.",
    why: "It is your floor and your entry area: the gap play buys at this shelf and puts the stop just below it, so your risk is well-defined.",
  },
  {
    id: "break-even-supply",
    term: "Break-even supply",
    short: "A volume shelf above the current price that tends to act as resistance (a ceiling).",
    plain:
      "A volume shelf is a price band where heavy volume traded, so it behaves like a wall. When such a shelf sits above today's price, the app calls it break-even supply. The reasoning: people who bought up there got stuck when price fell, so as price climbs back they sell to get out at break-even, which caps the move like a ceiling. In the code, classifyZone() tags a shelf 'break-even-supply' when the current price is at or below the shelf's bottom edge, and the app picks the closest one above price as the nearest supply.",
    why: "It is your ceiling, so it is the natural target: price often runs fast up to this overhead shelf and then stalls, which is where the gap play takes profit.",
  },
  {
    id: "gap-play",
    term: "The gap play (main play)",
    short: "Buy the lower shelf, ride the fast move through the gap up to the next shelf.",
    plain:
      "This is the app's main setup. Between two heavy-volume shelves there is often a volume gap, or air pocket, where almost nothing traded, so price slides through it quickly. The plan is to buy at the lower shelf (support) and aim for the shelf on the far side of the gap (the target). In the code the entry is the top of the support shelf, the stop is just under that shelf's low (0.5% below), and the target is the near edge of the next shelf above, giving a reward-to-risk number (R). The play is marked 'active' only when price is actually sitting at the support shelf, ready to go.",
    why: "It gives you a clean, mechanical trade: a set entry, a stop right under support, and a target across the air pocket, with an R multiple telling you the payoff before you ever click buy.",
  },
  {
    id: "relative-strength",
    term: "Relative strength (RS)",
    short: "Whether the stock is beating the market (SPY/QQQ) or lagging it. You want leaders.",
    plain:
      "Relative strength answers a simple question: is this stock stronger than the overall market, or weaker? The app measures it by comparing the stock's return to a benchmark's over both about one month (21 trading days) and about three months (63 days); if the stock's gain is bigger, it is outperforming. It also tracks an RS line (the stock's price divided by the benchmark's) and checks whether that line is near its own recent high or above its own 50-day average, both signs of a true leader. The RS gate passes only when the stock beats the benchmark over both windows and its RS line is near a high or above its average.",
    why: "Strong stocks tend to keep leading and pull back less, so demanding relative strength keeps you buying leaders instead of laggards.",
  },
  {
    id: "avwap",
    term: "AVWAP (Anchored VWAP)",
    short: "The average price everyone paid since a chosen start date; a break-even line.",
    plain:
      "You pick a meaningful starting bar, like a big high, a big low, the start of the year, or an earnings date. From that bar to today, AVWAP is the volume-weighted average price paid, so it shows the break-even cost for everyone who bought since then. The app also checks whether that line is rising, flat, or falling and whether price is above or below it. Price above a rising AVWAP means buyers are in control (bullish); price below a falling one means sellers are in control (bearish).",
    why: "It tells you at a glance whether the average buyer since your anchor is winning or losing, which sets the tone for taking a long trade.",
  },
  {
    id: "avwap-reclaim",
    term: "AVWAP reclaim / loss",
    short: "Closing back above the AVWAP is a reclaim (bullish); closing back below is a loss.",
    plain:
      "The app watches the last few bars (5 by default) to see if price crossed the AVWAP line. A reclaim is when price was below the line and then closes back above it, a bullish trigger that momentum is turning up. A loss is the opposite: price closes back below the line after being above. If no recent cross happened, price is simply holding above or holding below the line.",
    why: "A fresh reclaim is the app's green-light trigger to buy support; without it the call is usually WAIT FOR RECLAIM, so you don't buy too early.",
  },
  {
    id: "avwap-pinch",
    term: "AVWAP pinch (confluence)",
    short: "Two or more AVWAPs from different anchors bunched at nearly the same price.",
    plain:
      "The app builds several AVWAPs from different starting points (the 52-week high, the 52-week low, and the start of the year). A pinch is when at least two of those lines cluster within about 3% of each other, stacking up into one shared level. The tighter they bunch (the smaller the spread), the stronger and more meaningful that level becomes. The app also flags when the current price is sitting right inside that pinch band.",
    why: "Several independent break-even lines agreeing on one price makes that level a stronger wall, so a bounce or a break there carries more weight.",
  },
  {
    id: "avwap-bands",
    term: "AVWAP bands (±1σ / ±2σ)",
    short: "Lines one and two standard deviations from the AVWAP that show how stretched price is.",
    plain:
      "Around the AVWAP line, the app draws bands one and two standard deviations (a measure of how much price normally wanders) away from it, measured from the volume-weighted spread of prices since the anchor — so they widen when trading is choppy and tighten when it is calm. Price sits inside ±1σ most of the time (the normal range). Reaching ±2σ is stretched: the upper 2σ is a take-profit / don't-initiate zone, and the lower 2σ is the deep reversion-into-support zone where a bounce back toward the mean is likely.",
    why: "The bands tell you if you're chasing an over-extended move or entering while price is still close to fair value, and they help project realistic targets — the whole 'am I chasing?' check.",
  },
  {
    id: "obv",
    term: "OBV (On-Balance Volume)",
    short: "A running volume tally that rises on up days and falls on down days.",
    plain:
      "On-Balance Volume adds the day's volume when price closes up and subtracts it when price closes down, keeping a running total. The line itself doesn't matter — its direction does. When OBV is rising, buyers are accumulating (often before price breaks out), which is early confirmation. When price is making higher highs but OBV isn't keeping up, that's a divergence: fewer participants are backing the move, so it's more likely to fail.",
    why: "It separates a real, well-supported move from a thin one — a reason to take a setup with conviction, or to tighten up and skip one that volume isn't confirming.",
  },
  {
    id: "gates",
    term: "Gates",
    short: "Seven yes/no safety checks a stock must pass to count as a clean setup.",
    plain:
      "The app runs each stock through seven pass-or-fail tests: enough dollar volume and a high enough price (liquidity), an uptrend (above a flat-or-rising 200-day average and near the 50-day), beating the market (relative strength), a volume shelf right at the current price, an active gap play worth taking, price confirmed at its AVWAP break-even line, and a quiet, tightening market with no heavy selling bar (contraction). Each gate is just a green check or a red X. A stock that passes all seven is the cleanest kind of setup the scanner looks for.",
    why: "Gates keep you from buying something that looks exciting but is thin, in a downtrend, or lagging, so you only risk money on setups that clear every basic check.",
  },
  {
    id: "score",
    term: "Score / A+",
    short: "A 0-100 rank of setup quality across the scan; A+ means it passes all gates.",
    plain:
      "After grading every stock, the app scores several quality measures (shelf-at-price, gap-play quality, relative strength, AVWAP, and more) and stretches each one onto a 0-to-1 scale by comparing it to the rest of the scan. Those measures are blended with weights (the shelf and gap play matter most) into a single 0-100 number, so the score is always relative to the other stocks scanned that day. Results are then sorted: stocks that pass all seven gates come first, then those with more of the key gates, then by the score. A stock earns A+ only when it passes every gate.",
    why: "The score tells you which names to look at first, and A+ flags the handful that clear every check, so you spend attention on the strongest candidates.",
  },
  {
    id: "levels",
    term: "Entry / Stop / Target",
    short: "Where you buy, where you bail if wrong, and where you take profit.",
    plain:
      "Entry is your buy trigger: a close back above the top of the volume shelf (or the fair-price POC) as price pushes up into the air pocket. Stop is where you admit you were wrong and get out: just below the shelf's low, set 0.5% under it, because a decisive drop below the shelf breaks the whole idea. Target is where you plan to take profit: the first target (T1) is the far side of the gap, the next shelf up, or the POC, and a second target (T2) sits further out at the top of the value area or beyond.",
    why: "Deciding all three before you buy turns a hope into a plan, so you know your buy price, your maximum loss, and your payoff instead of reacting with emotion.",
  },
  {
    id: "r-multiple",
    term: "R-multiple (R:R)",
    short: "Reward compared to risk; 2R means you'd make twice what you'd lose if stopped out.",
    plain:
      "R is your risk: the distance from your entry down to your stop. The app measures each target in Rs, so if the target is twice as far above your entry as your stop is below it, that target is 2R. It calculates this as the gain to the target divided by that risk distance. For a gap play it uses the same idea, comparing the reward percentage up to the target against the risk percentage down to the stop.",
    why: "R:R shows whether a trade is worth taking at all; risking a dollar to make two can pay off even when you're often wrong, while risking a lot to make a little rarely does.",
  },
  {
    id: "verdict",
    term: "Verdict (BUY / WAIT / WATCH / AVOID)",
    short: "One plain-English call that combines all the checks into a single decision.",
    plain:
      "The app rolls the gates and levels into one clear call. AVOID means it's too thin or cheap, or a downtrend with nothing to lean on. ON WATCH means the setup is close but not ready, either a downtrend with a real shelf, or an uptrend where price hasn't pulled back to support yet. WAIT FOR RECLAIM means the shelf is there but price is still below its AVWAP break-even line, so you wait for a close back above it. BUY THE DIP or BUY is the green light: uptrend, price resting on a fat shelf, and the AVWAP confirming, with BUY reserved for when an active gap play is set to go.",
    why: "The verdict saves you from weighing seven checks yourself, giving you a single calm decision plus the exact level to act on so you don't jump in early or force a bad trade.",
  },
  {
    id: "thesis",
    term: "Bull & bear thesis",
    short: "Both directional cases — each with a trigger, targets and an invalidation.",
    plain:
      "Instead of predicting one direction, the app lays out both sides, the way Wujastyk does. The bull case says: if price closes back above a specific trigger (the shelf top or POC), buyers are in control and the volume overhead becomes the target — with an invalidation just below the shelf. The bear case mirrors it: if price loses the shelf low on volume, the thin area beneath opens an air pocket down to the next shelf, and it's wrong if price reclaims the shelf. Each case is built from the actual volume structure, so the levels are concrete, not vibes.",
    why: "Holding both cases keeps you honest: you know exactly what would confirm you're right, and exactly what says you're wrong, before you risk a cent.",
  },
  {
    id: "confirmation",
    term: "Secondary confirmation (MACD · RSI · % range)",
    short: "Momentum reads stacked around the volume core to confirm the turn.",
    plain:
      "Around the volume shelf and AVWAP, Wujastyk layers momentum tools. MACD compares a fast and slow average — above its signal line means momentum is turning up. RSI (0–100) measures how stretched the recent move is — under 30 is oversold (snap-back watch), over 70 is overbought (extended). '% range' shows where price sits inside its last 14 bars, from 0% (at the low, a mean-reversion zone) to 100% (at the high, extended). The 5-day average rising shows the short-term trend has turned up. These confirm the volume read; they don't lead it.",
    why: "The volume levels tell you where to act; these tell you whether momentum is actually turning there yet, so you don't buy a shelf that's still falling.",
  },
  {
    id: "confluence-score",
    term: "Confluence scorecard",
    short: "Wujastyk's whole method as a 10-item score across six tiers.",
    plain:
      "This turns Jake's process into one scoreable gate. Ten independent checks across six tiers: (1) confluence — price on a shelf above the 200-day with the 5-day rising, an AVWAP pinch, and holding the value-area low; (2) trigger — a reversal or AVWAP-reclaim candle actually on the level; (3) volume — reaction volume at least 1.5× the 20-day average; (4) momentum — RSI above 50 with the MACD histogram turning up; (5) market/RS — the index isn't breaking down and the name is outperforming, with the weekly trend aligned; (6) exhaustion — price within about 1 standard deviation of the anchored mean (not stretched), with a clean stop and reward-to-risk of at least 1.5. The more that line up at the same zone, the higher the conviction.",
    why: "It rewards buying support that's stretched below its anchored mean with confirmation — the setup with real edge — and warns you off chasing something already extended, which is the exact discipline that separates a plan from a gamble.",
  },
  {
    id: "mean-reversion",
    term: "Mean-reversion-into-strength",
    short: "His published scanner: above POC & 200-day, 5-day rising, still below AVWAP.",
    plain:
      "This is the exact filter from Wujastyk's published scanner. It flags a name when four things line up: price is above the volume POC (on a volume floor), price is above the 200-day average (healthy long-term trend), the 5-day average is rising (short-term turning up), and price is still below its anchored VWAP (the average everyone paid — so there's room to run up to it). It's a 'buy strength that's temporarily below its mean' setup.",
    why: "When all four align you get an uptrend pulling back to a floor with room to travel back up to fair value — a high-quality, repeatable entry rather than chasing.",
  },
  {
    id: "avwap-map",
    term: "AVWAP map (Shannon)",
    short: "Every event-anchored AVWAP stacked around price: supply above, support below.",
    plain:
      "Brian Shannon's method anchors a VWAP to every event where a crowd of traders established positions — the year/quarter/month start, the 52-week and all-time high and low, the biggest gap day, the highest-volume day, even the first traded bar. Each line is that crowd's average cost. Lines above price are supply (those buyers are underwater and tend to sell at break-even); lines below are support (those holders are profitable and tend to defend their cost). The map stacks them all around today's price so you can see the nearest wall in each direction.",
    why: "Rallies stall at overhead AVWAPs and pullbacks catch at supporting ones — the map shows you exactly which level is next, and why it matters.",
  },
  {
    id: "stage",
    term: "Market stage (1–4)",
    short: "Base (1) → markup (2) → distribution (3) → decline (4). Only buy stage 2.",
    plain:
      "Every stock cycles through four stages: Stage 1 is a flat base after a decline (accumulation), Stage 2 is the markup uptrend, Stage 3 is a stalling top (distribution), and Stage 4 is the decline. This app classifies the stage from where price sits relative to its 200-day average, the 200-day's slope now, and its slope two quarters ago (which tells a flat line after a fall apart from a flat line after a rise).",
    why: "Shannon's rule: the odds only favor long trades in Stage 2. Knowing the stage stops you bottom-fishing Stage 4 or overstaying Stage 3.",
  },
  {
    id: "handoff",
    term: "AVWAP handoff",
    short: "In an uptrend, the AVWAP from each newer higher low takes over as support.",
    plain:
      "As an uptrend climbs, each pullback sets a higher low, and the AVWAP anchored to that newest low becomes the working support line — the older lows' AVWAPs 'hand off' the job. The handoff is intact while the low-anchored AVWAPs stack upward and price holds above the newest one. If price loses the newest AVWAP, the older ones underneath are the next tests.",
    why: "It gives you a rising, volume-weighted trail for stops and add points that tightens as the trend matures — instead of a stale line from months ago.",
  },
  {
    id: "expectancy",
    term: "Expectancy (R)",
    short: "Average result per trade, measured in units of what you risked.",
    plain:
      "Every tracked trade risks a known amount: entry minus stop, times shares — that's 1R. A trade that makes twice what it risked is +2R; a stop-out is −1R. Expectancy is the average R across all your closed trades in the journal. +0.3R means that following the system earned you, on average, 30% of your risked amount per trade — win rate alone can't tell you that (a 70% win rate with big losses can still lose money).",
    why: "It's the single number that says whether your process makes money over time. Positive and stable across 20+ trades = a real edge; negative = fix the process before sizing up.",
  },
  {
    id: "portfolio-heat",
    term: "Portfolio heat & the discipline guard",
    short: "Total % of your account at risk across ALL open positions, plus the survival rules.",
    plain:
      "Portfolio heat is what you'd lose if every open stop got hit on the same day — the sum of each position's risk as a % of the account. The discipline guard checks it (cap ~6%, comfortable under 4%) along with the other survival rules the trading literature agrees on: risk ≤1% per trade (2% absolute ceiling), at most ~5 open positions, never doubling into a name you already hold, no new longs in a red (stage-4) market, cutting size in half after a losing streak instead of sizing up, and never taking a trade whose first target pays less than its risk.",
    why: "Most blown-up accounts die from correlated risk and revenge sizing, not from one bad pick. The guard makes those mistakes visible before the trade, when they're still free.",
  },
  {
    id: "final-call",
    term: "Final call (GO / WAIT / NO-GO)",
    short: "One merged decision per ticker — the strictest signal always wins.",
    plain:
      "The final call merges everything the app measures — the plain-English verdict, the market stage, weekly/daily alignment, the confluence scorecard, extension (chasing), and the discipline guard — into a single answer. Vetoes are absolute: a discipline block, a missing plan, or fighting the stage makes it NO-GO no matter how pretty the chart. An unearned trigger makes it WAIT. GO-HALF means the setup is valid but a caution flag (cold streak, drawdown, mixed regime) says take half size.",
    why: "A pile of indicators invites cherry-picking the ones that agree with what you already want to do. One call with the binding reason named removes that temptation.",
  },
  {
    id: "early-signal",
    term: "Early signal (stealth accumulation)",
    short: "Tells that precede the breakout the crowd waits for: dry-up, squeeze, OBV in, higher lows, pocket pivot.",
    plain:
      "Most traders' trigger is the breakout — by the time it prints, entries are crowded and the stop is far away. What tends to precede real breakouts is measurable: volume drying up (sellers exhausted), the range squeezing (a coiling spring), OBV climbing while price goes nowhere (someone accumulating without moving the tape), swing lows stepping up into a flat ceiling, and a pocket pivot (one up-day whose volume beats every down-day of the prior two weeks). The Early score weighs those tells while price is still UNDER the lid — early means before the trigger, not after it.",
    why: "It gets you stalking the name with alerts set before the obvious signal fires — better entry, tighter stop, and you're selling into the crowd's excitement instead of buying it. It's a heads-up, not a buy signal: the Final Call still decides.",
  },
];

const BY_ID = new Map(GLOSSARY.map((e) => [e.id, e]));
export function glossaryById(id: string): GlossaryEntry | undefined {
  return BY_ID.get(id);
}

/** Map a scanner gate key to its glossary id, for badge tooltips. */
export const GATE_GLOSSARY: Record<string, string> = {
  liquidity: "gates",
  trend: "gates",
  rs: "relative-strength",
  shelf: "volume-shelf",
  gap: "gap-play",
  avwap: "avwap",
  contraction: "gates",
};
