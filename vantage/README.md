# VANTAGE 5.3 — Cold Call Command

Single-file app (`index.html`) — no build step. Deploy anywhere that serves static files.

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
