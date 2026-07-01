import type { AnchoredVolumeProfile, VolumeGap } from "./types";
import {
  detectGaps,
  detectHvnShelves,
  type DetectParams,
  type ScoredShelf,
} from "./shelves";

/**
 * The Volume-Gap Play — the primary setup of the app.
 *
 * A volume gap (LVN "air pocket") is a low-volume price band that sits between
 * two high-volume shelves (HVN). Because little stock changed hands there, price
 * travels through it quickly. The trade: hold the lower shelf (support), then
 * ride the fast move *through the gap* to the far shelf (the target), where
 * volume — and friction — resumes. This is the volume-profile expression of
 * Brian Shannon's "trade toward acceptance (HVN), expect quick travel through
 * rejection (LVN)".
 */
export interface GapPlay {
  direction: "long";
  /** Support shelf the move launches from (price holds at/above it). */
  entryShelf: ScoredShelf;
  /** The low-volume air pocket price travels through. */
  gap: VolumeGap;
  /** Shelf on the far side of the gap — the destination, if one exists. */
  targetShelf: ScoredShelf | null;
  /** Reclaim trigger: a close back above the support-shelf top into the gap. */
  entry: number;
  /** Target: first contact with the far shelf (or the top of the gap). */
  target: number;
  /** Invalidation: just below the support-shelf low. */
  stop: number;
  /** Air-pocket height as a fraction of price (the fast-travel distance). */
  airPocketPct: number;
  rewardPct: number;
  riskPct: number;
  /** Reward-to-risk multiple. */
  rr: number;
  /** Distance from current price to the entry trigger (fraction; 0 = at it). */
  proximityPct: number;
  /** True when price is in the launch zone at the support shelf (ready to go). */
  active: boolean;
  /** Composite 0..1+ quality (air pocket × target strength × readiness × R:R). */
  quality: number;
}

export interface GapPlayParams extends DetectParams {
  /** k × mean-bin-volume threshold for HVN shelves. */
  shelfK: number;
  shelfMinBins: number;
  /** How close price must be to the support shelf for the play to be "active". */
  proximityPct: number;
}

/**
 * Enumerate every long volume-gap play in a profile: for each gap, pair it with
 * the nearest shelf below (support/entry) and the nearest shelf above (target).
 */
export function detectGapPlays(
  profile: AnchoredVolumeProfile,
  currentPrice: number,
  params: GapPlayParams,
): GapPlay[] {
  const shelves = detectHvnShelves(profile, currentPrice, params.shelfK, params.shelfMinBins);
  const gaps = detectGaps(profile, params);
  return buildGapPlays(shelves, gaps, currentPrice, params.proximityPct);
}

/** Build plays from already-detected shelves and gaps (kept separate for tests). */
export function buildGapPlays(
  shelves: ScoredShelf[],
  gaps: VolumeGap[],
  currentPrice: number,
  proximityRef: number,
): GapPlay[] {
  const plays: GapPlay[] = [];
  for (const gap of gaps) {
    let entryShelf: ScoredShelf | null = null;
    let targetShelf: ScoredShelf | null = null;
    for (const s of shelves) {
      if (s.priceHigh <= gap.priceLow + 1e-9) {
        if (!entryShelf || s.priceHigh > entryShelf.priceHigh) entryShelf = s;
      } else if (s.priceLow >= gap.priceHigh - 1e-9) {
        if (!targetShelf || s.priceLow < targetShelf.priceLow) targetShelf = s;
      }
    }
    if (!entryShelf) continue; // a play needs a support shelf to launch from

    const entry = entryShelf.priceHigh;
    const stop = entryShelf.priceLow * 0.995;
    const target = targetShelf ? targetShelf.priceLow : gap.priceHigh;
    const airPocketPct = currentPrice > 0 ? (gap.priceHigh - gap.priceLow) / currentPrice : 0;
    const rewardPct = entry > 0 ? (target - entry) / entry : 0;
    const riskPct = entry > 0 ? (entry - stop) / entry : 0;
    const rr = riskPct > 0 ? rewardPct / riskPct : 0;

    // Readiness: how close price is to the entry trigger (the support shelf).
    const proximityPct = currentPrice > 0 ? Math.abs(currentPrice - entry) / currentPrice : 1;
    // Active = price is in the launch zone (at the support shelf, or just above
    // its top by `proximityRef`), ready to reclaim into the gap. Prices in a
    // dead zone between a non-adjacent shelf and gap, or already extended deep
    // inside the gap, are watch candidates — not fresh at-the-shelf launches.
    const active =
      currentPrice >= entryShelf.priceLow * (1 - 0.005) &&
      currentPrice <= entryShelf.priceHigh * (1 + proximityRef);
    const readiness = active ? 1 : Math.max(0, 1 - proximityPct / (2 * proximityRef));

    const targetStrength = targetShelf ? targetShelf.strength : 1;
    const quality =
      clamp01(airPocketPct / 0.15) * 0.4 +
      clamp01(targetStrength / 4) * 0.25 +
      readiness * 0.2 +
      clamp01(rr / 3) * 0.15;

    plays.push({
      direction: "long",
      entryShelf,
      gap,
      targetShelf,
      entry,
      target,
      stop,
      airPocketPct,
      rewardPct,
      riskPct,
      rr,
      proximityPct,
      active,
      quality,
    });
  }
  return plays.sort((a, b) => b.quality - a.quality);
}

/**
 * Pick the primary gap play for a ticker: the best *active* play (price already
 * at the support shelf / in the gap) if any, otherwise the nearest gap play
 * above price as a watch candidate.
 */
export function selectPrimaryGapPlay(plays: GapPlay[], currentPrice: number): GapPlay | null {
  const active = plays.filter((p) => p.active);
  if (active.length > 0) return active[0];
  const above = plays
    .filter((p) => p.entry >= currentPrice)
    .sort((a, b) => a.proximityPct - b.proximityPct);
  if (above.length > 0) return above[0];
  return plays[0] ?? null;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}
