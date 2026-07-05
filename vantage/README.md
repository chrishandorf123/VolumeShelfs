# VANTAGE 5.8 — Cold Call Command

Single-file app (`index.html`) — no build step. Deploy anywhere that serves static files.

## New in 5.8

- **`O` works everywhere**: objection lookup opens from any screen — writing an email, browsing the playbook, mid-drill — not just on live calls.
- **Cadence shows the pipeline**: each step on the timeline shows how many active targets are sitting at it ("n HERE"), plus totals for in-cadence and cadence-complete targets — see where prospects pile up.
- **Targets ⬆ EXPORT CSV**: round-trip with import — download the current filtered list (name, company, title, phone, status, persona, hub, touches, last touch, notes) for CRM sync.

## New in 5.7

- **Objection Gym cards show your drill record** (✓/✕ counts) with a WEAK SPOT flag at ≥40% miss rate — your practice data visible where you browse, not just inside drill mode.
- **Stats: week-over-week deltas** — dials and meetings vs the prior 7 recorded days, colored by direction.
- Sprint HUD wraps cleanly on narrow screens.
- Gartner battle intel shipped in 5.6: the "Know Thyself" card (the three real 2022 MQ cautions competitors quote at Tulip + date-stamped counters), DELMIA licensing/architecture attack lines, and the 60%-composable-by-2025 prediction.

## New in 5.5 — Power Hour and the honest funnel

- **⚡ POWER HOUR sprint mode**: arm it on the dial setup screen (`P`), set minutes + a dial goal, and the live-call screen gets a countdown HUD with live pace (AHEAD / ON PACE / BEHIND — DIAL) and a goal bar. The debrief scores the sprint (WON / SHORT).
- **Meetings that actually happen**: MEETING targets get ✓ HELD / ✗ NO-SHOW buttons. Held → hand-off stamp; no-show → automatically requeued with a callback on tomorrow's due list. Stats now show your weekly **show rate** — the number most SDR dashboards hide.
- **Snooze (→2D)** on any due call or touch — busy days happen; the cadence bends instead of going stale. Snooze clears itself on any real touch.
- **Backup nag**: if your data hasn't been exported in 7+ days, the Board says so — one click downloads the full backup.

## New in 5.4 — every claim in the app was fact-checked (see RESEARCH.md)

A 105-agent deep-research pass verified Tulip facts against primary sources (July 2026) and the app now only asserts what survived:

- **New verified ammo**, front-loaded in the live-call pitch tab: Tulip company facts ($120M Series D, Jan 2026, led by Mitsubishi Electric at a $1.3B valuation · 43K apps / 60K workers / 1,000 sites / 45 countries · gen-AI +364%, automations +519% · IDC MarketScape 2024–25 MES **Leader**), VEKA −88% quality escapes, Innovafeed +500% production, Reframe 2.5×, Zaleco −20% scrap, Formlabs −20% lead time, Test Devices +50%, and Deloitte's 2026 Outlook budget stat (80% of manufacturers putting 20%+ of improvement budgets into smart manufacturing).
- **Stale claims corrected everywhere** (openers, pitches, VMs, AI prompts): "TICO 2x production" → the verified 50–60% inspection/rework cut + the ops director's "full-blown MES" quote; "AstraZeneca across 24 sites" → verified-safe pharma proof (Sharp 30% faster GxP packaging); J&J/Sartorius/Richemont name-drops removed; Forrester figures now attributed as "a 2023 Forrester study commissioned by Tulip."
- **⚠ VERIFY FIRST flags** on cards that couldn't be reconfirmed (AstraZeneca, Pratt Miller) — reconfirm before citing on a call. Competitor battle cards and cold-call benchmarks found no verifiable sources; treat as craft wisdom, not cited fact. Full citations: `RESEARCH.md`.

## New in 5.3

- **Your opener, personalized ×40**: Chris's real opener ("…I know I'm catching you out of the blue…") is now the FIRST opener on every persona — the "think X, Y, Z" line and closing question tuned to what that persona owns (CFO hears ROI and payback; Quality hears travelers and audit records; IT hears composable vs. monolith). Hub-specific persona variants got it too.
- **Objection drill learns you**: every ✓/✕ is remembered. Weak spots (≥40% miss rate) come up first next drill, are flagged on the card ("WEAK SPOT · MISSED n×"), and the debrief lists your top three.
- **SKIP in live calls** (`S`): bad number / wrong person — advance without polluting your dial stats.
- **Targets sort by NEXT DUE**: overdue first, with due date and LATE flag on every row.

## New in 5.2 — the cadence runs your day

- **THE LINE — DUE TODAY** (top of the Board): the cadence is now an engine. Every target's next touch is computed from its touch count and last-touch date — calls due (with overdue flags), callbacks they asked for, and email/LinkedIn/VM touches due. One click dials the due list; each non-call touch has **OPEN** (template pre-filled with that target) and **✓** (log it done).
- **Callback scheduling**: logging CALLBACK LATER books the target onto tomorrow's due list automatically.
- **Follow-ups owed**: the session debrief now lists a ready-to-send email for every VM and real conversation you logged — pre-filled, copy or open in mail. Send them before you stand up.
- **Call history + your real connect windows**: every dial is stored (last 1,500). After 20 dials, Stats shows your personal connect-rate by hour of day and flags your best window.
- **CSV import**: Targets → IMPORT CSV. Paste from Excel/Sheets/CRM export or pick a file; headers auto-detected, duplicates skipped, persona/hub applied in bulk.
- **Click-to-dial**: phone numbers are `tel:` links (softphone/mobile).
- **GOAL + STREAK on the andon**: dials today vs. your funnel-math daily target, and consecutive weekdays on goal.
- **AI assists** (uses your Anthropic key from FORGE): **✦ BRIEF** on any live call (opener angle, likely pain, proof point, likely objection), **✦ RUN DEBRIEF** after a session (three observations + tomorrow's drill).

## Hotkeys (added in 5.1)

Press **`?`** anywhere in the app for the cheat sheet. Keys pause automatically while you type; `ESC` hops out of any text field.

### Global
| Key | Action |
|---|---|
| `1`–`9` | Jump to a module (the rail shows each key) |
| `⌘K` / `Ctrl K` / `/` | Command palette — search modules, actions, personas, objections, templates, case studies, targets; hit Enter to jump straight there |
| `?` | Hotkey cheat sheet |
| `ESC` | Close any overlay / leave a text field |

### Dial — live call (hands stay on the keyboard between dials)
| Key | Action |
|---|---|
| `SPACE` | They picked up — start the clock |
| `1`–`6` | Disposition: no answer · VM · gatekeeper · not interested · callback · real convo |
| `M` | ★ Meeting booked |
| `O` | Objection lookup (then `↑` `↓` + `Enter` copies Track 1) |
| `N` | Jump to call notes |
| `←` `→` | Cycle talk track: opener / questions / pitch / VM |
| `E` | End session |

Setup: `S`/`Enter` starts with checked targets, `F` goes freestyle. After a booking: `N` next dial, `E` end. Debrief: `Enter` back to the board. Drill mode: `SPACE` reveal, `1` had it, `2` missed it.

## Deploy to Render

1. Push this folder to a GitHub repo (`index.html` + `render.yaml` at the root), or point Render at this `vantage/` subdirectory.
2. Render dashboard → New → Static Site → connect the repo.
   - Build Command: (leave blank)
   - Publish Directory: `.` (or `vantage` if deploying from the parent repo)
3. Deploy. HTTPS + CDN on the free tier.

## Notes

- Firebase auth + Firestore sync use the same `tulip-dial-command` project as VANTAGE v4/v5, so your existing account and saved Anthropic API key carry over automatically.
- "Work offline" on the sign-in screen runs everything on-device (localStorage) with zero backend.
- Full backup/restore lives in FORGE → Your Data (or the command palette: "download backup").
