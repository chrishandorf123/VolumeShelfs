import { GLOSSARY } from "./glossary";

let inited = false;

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
}

function renderGuide(query: string): void {
  const body = byId("guideBody");
  const q = query.trim().toLowerCase();
  const items = GLOSSARY.filter(
    (e) => !q || e.term.toLowerCase().includes(q) || e.plain.toLowerCase().includes(q) || e.short.toLowerCase().includes(q),
  );
  body.innerHTML =
    items
      .map(
        (e) => `<div class="guide-entry" id="g-${e.id}">
        <h3>${esc(e.term)}</h3>
        <p class="g-plain">${esc(e.plain)}</p>
        <p class="g-why"><b>Why it matters:</b> ${esc(e.why)}</p>
      </div>`,
      )
      .join("") || `<p class="muted">No matches.</p>`;
}

export function openGuide(id?: string): void {
  if (!inited) initGuide();
  const overlay = byId("guideOverlay");
  overlay.hidden = false;
  if (id) {
    const search = byId<HTMLInputElement>("guideSearch");
    if (search.value) {
      search.value = "";
      renderGuide("");
    }
    const target = document.getElementById(`g-${id}`);
    if (target) {
      target.scrollIntoView({ block: "center" });
      target.classList.add("flash");
      setTimeout(() => target.classList.remove("flash"), 1200);
    }
  }
}

function closeGuide(): void {
  byId("guideOverlay").hidden = true;
}

export function initGuide(): void {
  if (inited) return;
  const overlay = byId("guideOverlay");
  byId("guideBtn").addEventListener("click", () => openGuide());
  byId("guideClose").addEventListener("click", closeGuide);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeGuide();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeGuide();
  });
  byId<HTMLInputElement>("guideSearch").addEventListener("input", (e) =>
    renderGuide((e.target as HTMLInputElement).value),
  );
  // Any element tagged data-glossary opens the guide at that term. Capture
  // phase + stopPropagation so it doesn't also trigger e.g. row selection.
  document.addEventListener(
    "click",
    (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>("[data-glossary]");
      if (t) {
        e.preventDefault();
        e.stopPropagation();
        openGuide(t.getAttribute("data-glossary") ?? undefined);
      }
    },
    true,
  );
  renderGuide("");
  inited = true;
}
