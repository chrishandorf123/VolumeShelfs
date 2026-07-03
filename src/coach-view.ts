import type { CoachStep } from "./core";

const KIND_META: Record<CoachStep["kind"], { icon: string; label: string }> = {
  do: { icon: "▶", label: "Do" },
  wait: { icon: "◔", label: "Wait for" },
  risk: { icon: "⛨", label: "Protect" },
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** Numbered "what to do next" list — the coach that walks the user through the trade. */
export function coachPanelHtml(steps: CoachStep[]): string {
  if (steps.length === 0) return "";
  const lis = steps
    .map((s, i) => {
      const m = KIND_META[s.kind];
      return `<li class="coach-step coach-${s.kind}">
        <span class="cs-n">${i + 1}</span>
        <span class="cs-kind" title="${m.label}">${m.icon} ${m.label}</span>
        <span class="cs-text">${escapeHtml(s.text)}</span>
      </li>`;
    })
    .join("");
  return `<div class="panel coach-panel"><h2 data-glossary="levels" title="Click to learn">Your next steps</h2>
    <ol class="coach-steps">${lis}</ol></div>`;
}
