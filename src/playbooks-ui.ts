/**
 * Playbooks tab: the public methods of well-known traders as cards, each with
 * (a) their style in plain English, (b) how VolumeShelfs maps it, and (c) a
 * LIVE screen run over your last scan where the data honestly supports one.
 */
import { PLAYBOOKS } from "./data/playbooks";
import { obvRead } from "./core";
import { registerChatContext } from "./chat/context";
import type { ScannerUi } from "./scanner-ui";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

export interface PlaybooksUi {
  activate(): void;
}

export function initPlaybooks(scanner: ScannerUi, openTicker: (ticker: string) => void): PlaybooksUi {
  const body = $("playbooksBody");
  const meta = $("pbMeta");

  function render(): void {
    const results = scanner.results();
    const scanned = results.length;
    meta.textContent = scanned
      ? `screens run over your last scan (${scanned} names)`
      : "run a scan on the Scanner tab and the screens below light up with live names";

    body.innerHTML = PLAYBOOKS.map((p) => {
      // Live screen hits (cap the chips; the screen names the count honestly).
      let screenHtml = "";
      if (p.screen) {
        const hits: Array<{ ticker: string; note: string }> = [];
        for (const r of results) {
          const note = p.screen.test(r, scanner.candlesOf(r.ticker));
          if (note) hits.push({ ticker: r.ticker, note });
        }
        const chips = hits
          .slice(0, 14)
          .map(
            (h) =>
              `<button class="pb-hit" type="button" data-ticker="${h.ticker}" title="${esc(h.note)} — open in Scanner">${h.ticker}</button>`,
          )
          .join("");
        screenHtml = `<div class="pb-screen">
          <div class="pb-screen-head"><span class="pb-screen-label">▶ ${esc(p.screen.label)}</span>
            <span class="muted">${scanned ? `${hits.length} of ${scanned} pass${hits.length > 14 ? " · first 14 shown" : ""}` : "awaiting a scan"}</span></div>
          <div class="pb-hits">${chips || `<span class="muted">${scanned ? "No names pass right now." : ""}</span>`}</div>
        </div>`;
      }
      return `<article class="pb-card">
        <header class="pb-head">
          <div>
            <h3>${esc(p.name)} <a class="pb-handle" href="${p.url}" target="_blank" rel="noopener noreferrer">${esc(p.handle)} ↗</a></h3>
            <p class="pb-who muted">${esc(p.who)}</p>
          </div>
        </header>
        <div class="pb-cols">
          <div><h4>Their playbook</h4><ul>${p.style.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></div>
          <div><h4>In this app</h4><ul>${p.mapsTo.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></div>
        </div>
        ${screenHtml}
        ${p.caution ? `<p class="pb-caution">⚠ ${esc(p.caution)}</p>` : ""}
      </article>`;
    }).join("");

    body.querySelectorAll<HTMLButtonElement>(".pb-hit").forEach((b) => {
      b.addEventListener("click", () => openTicker(b.dataset.ticker!));
    });
  }

  // Chat coach knows what the playbooks see.
  registerChatContext("playbooks", () => {
    const results = scanner.results();
    if (!results.length) return "PLAYBOOKS TAB — trader-style cards loaded; no scan yet, so the live screens are empty.";
    const lines = ["PLAYBOOKS TAB — live screen hits from the last scan:"];
    for (const p of PLAYBOOKS) {
      if (!p.screen) continue;
      const hits = results.filter((r) => p.screen!.test(r, scanner.candlesOf(r.ticker)));
      lines.push(`- ${p.name} (${p.screen.label}): ${hits.length ? hits.slice(0, 10).map((r) => r.ticker).join(", ") : "none"}`);
    }
    const obvAcc = results.filter((r) => obvRead(scanner.candlesOf(r.ticker))?.state === "accumulation");
    if (obvAcc.length) lines.push(`OBV accumulation names: ${obvAcc.slice(0, 10).map((r) => r.ticker).join(", ")}.`);
    return lines.join("\n");
  });

  return {
    activate() {
      render(); // scan may have changed while away
    },
  };
}
