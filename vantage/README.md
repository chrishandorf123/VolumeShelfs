# VANTAGE 5.1 — Cold Call Command

Single-file app (`index.html`) — no build step. Deploy anywhere that serves static files.

## New in 5.1 — full hotkey system

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
