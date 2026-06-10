import type { DexPair, Flag, ScoredLaunch, Tier } from "./types";
import { assessSafety } from "./assess";

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic launch scoring engine — the product's moat.
//
// No LLM (preserves margin + reproducibility). Two sub-scores feed one
// safety-gated composite plus an agent-actionable tier:
//
//   safetyScore   0-100  higher = lower trap/rug risk   (partial pre-onchain)
//   momentumScore 0-100  higher = more early traction
//   composite     0-100  safety-gated blend
//   tier          HOT | WATCH | AVOID
//
// Tunables live at the top so they can be recalibrated against real launches
// (plan Faz 0b exit criterion: calibrate scores on real examples).
// ─────────────────────────────────────────────────────────────────────────────

const CFG = {
  // Liquidity ($USD) reference points for log scaling.
  liqFloor: 2_000, // below this = high rug/exit-scam risk
  liqGood: 50_000, // healthy early liquidity
  liqGreat: 500_000,
  // Age windows (minutes).
  tooFresh: 5, // < this = unproven, contract barely live
  alphaWindow: 240, // sweet spot for "early" (first 4h)
  // Momentum.
  volToLiqHot: 1.0, // h1 volume >= liquidity = strong rotation
  minBuyersH1: 15, // healthy early unique-ish activity (buys proxy)
  // Safety gating.
  safetyHardFloor: 35, // below this, composite is capped → AVOID
  // Tier thresholds.
  hotComposite: 70,
  hotSafety: 60,
  watchComposite: 45,
} as const;

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/** Log-scaled 0-100 between two reference points. */
function logScale(value: number, floor: number, ceil: number): number {
  if (value <= floor) return 0;
  if (value >= ceil) return 100;
  return clamp((Math.log(value / floor) / Math.log(ceil / floor)) * 100);
}

function ageMinutes(pair: DexPair, now: number): number | null {
  if (!pair.pairCreatedAt) return null;
  return Math.max(0, (now - pair.pairCreatedAt) / 60_000);
}

function momentum(pair: DexPair, ageMin: number | null): { score: number; flags: Flag[] } {
  const flags: Flag[] = [];
  const liq = pair.liquidity?.usd ?? 0;
  const volH1 = pair.volume?.h1 ?? 0;
  const buysH1 = pair.txns?.h1?.buys ?? 0;

  // 1) Liquidity depth (40%).
  const liqScore = logScale(liq, CFG.liqFloor, CFG.liqGreat);

  // 2) Volume rotation relative to liquidity (35%).
  const volToLiq = liq > 0 ? volH1 / liq : 0;
  const rotationScore = clamp((volToLiq / CFG.volToLiqHot) * 100);
  if (volToLiq >= CFG.volToLiqHot) {
    flags.push({ code: "HIGH_ROTATION", label: "Strong early volume", severity: "info" });
  }

  // 3) Buyer activity (15%).
  const buyerScore = clamp((buysH1 / CFG.minBuyersH1) * 100);

  // 4) Freshness shaping (10%): reward the alpha window, penalise stale.
  let freshScore = 50;
  if (ageMin !== null) {
    if (ageMin < CFG.tooFresh) freshScore = 35;
    else if (ageMin <= CFG.alphaWindow) freshScore = 100;
    else freshScore = clamp(100 - (ageMin - CFG.alphaWindow) / 30);
  }

  const score = clamp(
    liqScore * 0.4 + rotationScore * 0.35 + buyerScore * 0.15 + freshScore * 0.1,
  );
  return { score: Math.round(score), flags };
}

function safety(pair: DexPair, ageMin: number | null): { score: number; flags: Flag[] } {
  const flags: Flag[] = [];
  let score = 70; // neutral-ish baseline; onchain enrichment can raise/lower later
  const liq = pair.liquidity?.usd ?? 0;
  const buysH1 = pair.txns?.h1?.buys ?? 0;
  const sellsH1 = pair.txns?.h1?.sells ?? 0;

  // Liquidity floor — thinnest pools are the easiest rugs.
  if (liq < CFG.liqFloor) {
    score -= 45;
    flags.push({ code: "LOW_LIQUIDITY", label: `Liquidity < $${CFG.liqFloor / 1000}k`, severity: "danger" });
  } else if (liq < CFG.liqGood) {
    score -= 15;
    flags.push({ code: "THIN_LIQUIDITY", label: "Below healthy liquidity", severity: "warn" });
  }

  // Honeypot proxy: meaningful buys but ~zero sells → people can buy, not sell.
  if (buysH1 >= 10 && sellsH1 === 0) {
    score -= 40;
    flags.push({ code: "NO_SELLS", label: "Buys but no sells (honeypot risk)", severity: "danger" });
  } else if (buysH1 + sellsH1 >= 20 && sellsH1 / (buysH1 + sellsH1) < 0.1) {
    score -= 20;
    flags.push({ code: "SKEWED_SELLS", label: "Very few sells vs buys", severity: "warn" });
  }

  // Unproven contract: extremely new with little to verify.
  if (ageMin !== null && ageMin < CFG.tooFresh) {
    score -= 10;
    flags.push({ code: "UNPROVEN", label: "Minutes old, unproven", severity: "warn" });
  }

  return { score: Math.round(clamp(score)), flags };
}

function decideTier(composite: number, safetyScore: number): Tier {
  if (composite >= CFG.hotComposite && safetyScore >= CFG.hotSafety) return "HOT";
  if (composite >= CFG.watchComposite) return "WATCH";
  return "AVOID";
}

/** Score a single Base pair into the product's core output object. */
export function scoreLaunch(pair: DexPair, now: number = Date.now()): ScoredLaunch {
  const ageMin = ageMinutes(pair, now);
  const m = momentum(pair, ageMin);
  const s = safety(pair, ageMin);

  // Safety-gate the composite: a dangerous launch can never look attractive.
  let composite = Math.round(s.score * 0.5 + m.score * 0.5);
  if (s.score < CFG.safetyHardFloor) composite = Math.min(composite, 25);

  const tier = decideTier(composite, s.score);

  const flags = [...s.flags, ...m.flags];
  if (pair.info?.socials?.length) {
    flags.push({ code: "HAS_SOCIALS", label: "Has social links", severity: "info" });
  }

  return {
    address: pair.baseToken.address,
    symbol: pair.baseToken.symbol,
    name: pair.baseToken.name,
    type: "token",
    chain: "base",
    dex: pair.dexId,
    pairAddress: pair.pairAddress,
    ageMinutes: ageMin === null ? null : Math.round(ageMin),
    priceUsd: pair.priceUsd ? Number(pair.priceUsd) : null,
    liquidityUsd: pair.liquidity?.usd ?? null,
    safetyScore: s.score,
    momentumScore: m.score,
    composite,
    tier,
    flags,
    safetyPartial: true, // DexScreener-only until assessSafety() runs
    safetyConfidence: 0,
    checks: [],
    dexscreenerUrl: pair.url,
    scoredAt: new Date(now).toISOString(),
  };
}

export function scoreLaunches(pairs: DexPair[], now: number = Date.now()): ScoredLaunch[] {
  return pairs.map((p) => scoreLaunch(p, now));
}

// ─── Onchain-enriched scoring ────────────────────────────────────────────────
// Runs the full safety assessment (honeypot.is + contract reads + holder/LP
// analysis), folds its delta into the safety score, recomputes the safety-gated
// composite + tier, and attaches the transparent checks + confidence.

/** Recompute the safety-gated composite + tier after a safety adjustment. */
function finalize(safetyScore: number, momentumScore: number): { composite: number; tier: Tier } {
  let composite = Math.round(safetyScore * 0.5 + momentumScore * 0.5);
  if (safetyScore < CFG.safetyHardFloor) composite = Math.min(composite, 25);
  return { composite, tier: decideTier(composite, safetyScore) };
}

export async function scoreLaunchOnchain(
  pair: DexPair,
  now: number = Date.now(),
  // Single-token queries run the full battery incl. Etherscan-backed signals; the
  // bulk feed passes false (see scoreLaunchesOnchain) to stay inside its 60s budget.
  runEtherscan: boolean = true,
): Promise<ScoredLaunch> {
  const partial = scoreLaunch(pair, now);
  // Only spend the heavy holder/LP RPC budget on launches with enough liquidity to
  // be worth deep analysis; obvious low-liquidity junk is AVOID on cheap signals alone.
  const deep = (pair.liquidity?.usd ?? 0) >= 5000;
  const a = await assessSafety(pair, now, deep, runEtherscan);

  const safetyScore = clamp(partial.safetyScore + a.scoreDelta);
  const { composite, tier } = finalize(safetyScore, partial.momentumScore);

  return {
    ...partial,
    safetyScore: Math.round(safetyScore),
    composite,
    tier,
    flags: [...partial.flags, ...a.flags],
    checks: a.checks,
    safetyConfidence: a.confidence,
    safetyPartial: a.partial,
    safety: a.details,
  };
}

/** Score many launches with onchain enrichment, bounded so we don't hammer the RPC. */
export async function scoreLaunchesOnchain(
  pairs: DexPair[],
  now: number = Date.now(),
  concurrency = 6,
): Promise<ScoredLaunch[]> {
  const out: ScoredLaunch[] = [];
  for (let i = 0; i < pairs.length; i += concurrency) {
    const batch = pairs.slice(i, i + concurrency);
    // Feed skips the serialized Etherscan signals to protect the route's 60s budget;
    // the per-token endpoint runs them. Feed still gets the cheap log-reuse signals.
    out.push(...(await Promise.all(batch.map((p) => scoreLaunchOnchain(p, now, false)))));
  }
  return out;
}
