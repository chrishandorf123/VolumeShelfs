import type { Position } from "./core";

const KEY = "vs.positions.v1";

/** Load tracked positions; malformed storage degrades to an empty journal. */
export function loadPositions(): Position[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is Position =>
        !!p &&
        typeof (p as Position).symbol === "string" &&
        Number.isFinite((p as Position).entry) &&
        Number.isFinite((p as Position).stop) &&
        Number.isFinite((p as Position).shares),
    );
  } catch {
    return [];
  }
}

export function savePositions(positions: Position[]): void {
  localStorage.setItem(KEY, JSON.stringify(positions));
}

export function addPosition(p: Position): Position[] {
  const all = [...loadPositions(), p];
  savePositions(all);
  return all;
}

export function updatePosition(updated: Position): Position[] {
  const all = loadPositions().map((p) => (p.id === updated.id ? updated : p));
  savePositions(all);
  return all;
}

export function removePosition(id: string): Position[] {
  const all = loadPositions().filter((p) => p.id !== id);
  savePositions(all);
  return all;
}
