/**
 * The fun part: when a setup goes GO (or a watched name fires its trigger),
 * rain money across the screen. Pure cosmetics — throttled, auto-cleaning,
 * and it respects prefers-reduced-motion.
 */
const EMOJI = ["💵", "💰", "🤑", "🚀", "📈", "💸", "🪙"];
let lastAt = 0;

export function celebrate(message: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const now = Date.now();
  if (now - lastAt < 8000) return; // one party at a time
  lastAt = now;

  const layer = document.createElement("div");
  layer.className = "celebrate";
  layer.setAttribute("aria-hidden", "true");
  const bits = Array.from({ length: 28 }, (_, i) => {
    const left = (i * 37 + 11) % 100;
    const delay = (i % 13) * 90;
    const dur = 1500 + (i % 7) * 190;
    const size = 17 + (i % 5) * 7;
    const drift = ((i % 9) - 4) * 12;
    return `<span class="cel-item" style="left:${left}%;animation-delay:${delay}ms;animation-duration:${dur}ms;font-size:${size}px;--drift:${drift}px">${EMOJI[i % EMOJI.length]}</span>`;
  }).join("");
  layer.innerHTML = `${bits}<div class="cel-banner">${message.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)}</div>`;
  document.body.appendChild(layer);
  window.setTimeout(() => layer.remove(), 2800);
}
