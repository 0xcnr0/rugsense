import { track, redisExec, analyticsEnabled } from "./analytics";
import { getPairsForToken, primaryPair } from "./dexscreener";
import { resolveDeployerAddress } from "./deployer";
import { flagWallets } from "./reputation";
import type { Address } from "viem";
import type { ScoredLaunch, Tier } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Track-record + verifiable scoreboard. The moat made visible.
//
// Two things live here:
//   1. CATCHES ("rugs we caught before they rugged"): when we score a launch AVOID
//      with a dangerous reason, we snapshot it; a periodic recheck confirms which
//      actually died (liquidity drained / pool gone). Confirmed catches become
//      public proof (/caught).
//   2. SCOREBOARD: we ALSO snapshot the HOT/WATCH calls and follow EVERY verdict to
//      a terminal outcome (rugged vs survived). That yields a leakage-free,
//      point-in-time hit rate — "X% of our AVOIDs rugged; Y% of our HOTs didn't" —
//      computed only from outcomes observed AFTER the call. This is the one axis a
//      freshly-prompted agent + free APIs cannot reproduce: an audited track record.
//
// Why point-in-time matters: any accuracy claim built from post-collapse data is
// inflated by temporal leakage (arXiv 2602.21529). Snapshots are written at score
// time; outcomes are observed strictly later. The numbers are honest by construction.
//
// Storage: the same Upstash/Vercel-KV REST that powers analytics. No-op without
// credentials. Keys:
//   rugwatch:rec:<addr>       JSON snapshot of an AVOID candidate (public-catch lane)
//   rugwatch:watch            ZSET (score = scoredAt ms) of AVOID candidates watched
//   rugwatch:caught           ZSET (score = caughtAt ms) of confirmed public catches
//   rugwatch:caught:<addr>    JSON of the confirmed catch
//   rugwatch:orec:<addr>      JSON snapshot of a HOT/WATCH candidate (scoreboard lane)
//   rugwatch:owatch           ZSET (score = scoredAt ms) of HOT/WATCH calls watched
//   rugwatch:stat:rugged:<T>  counter: verdict T calls that rugged   (T = AVOID|WATCH|HOT)
//   rugwatch:stat:survived:<T> counter: verdict T calls that survived the watch window
//   rugwatch:stat:rugged72h:AVOID  counter: AVOIDs that rugged within 72h of the call
//   rugwatch:resolved         ZSET (score = resolvedAt ms) of resolved outcomes (backtest)
//   rugwatch:resolved:<addr>  JSON of a resolved outcome
// Counters are incremented ONLY at terminal time (once per token — the token is then
// removed from its watch set), so they never double-count on re-scores.
// ─────────────────────────────────────────────────────────────────────────────

const MIN_LIQ_TO_WATCH = 2_000; // only follow tokens that had real liquidity
const RUG_LIQ_FRACTION = 0.35; // liquidity below this fraction of flagged value ⇒ rugged
const MAX_WATCH_AGE_MS = 7 * 24 * 60 * 60 * 1000; // survived a week ⇒ not a rug, stop watching
const RUG_72H_MS = 72 * 60 * 60 * 1000;
const RESOLVED_CAP = 500; // keep the backtest log bounded

// Danger flags that make an AVOID verdict a credible "this will rug" call.
const RUG_FLAGS = new Set([
  "HONEYPOT", "EXTREME_TAX", "LP_UNSECURED", "SNIPED", "HIGH_CONCENTRATION",
  "SERIAL_DEPLOYER", "COORDINATED_WALLETS", "STAR_DISTRIBUTION", "MINTABLE",
]);

export interface RugCandidate {
  address: string;
  symbol: string;
  name: string;
  dex: string;
  verdict: Tier; // the call we made at scoredAt
  scoredAt: number; // ms
  liqAtScore: number;
  priceAtScore: number | null;
  topFlag: string; // for AVOID: the danger flag; for HOT/WATCH: top flag or ""
}

export interface RugCatch extends RugCandidate {
  caughtAt: number; // ms
  liqAtCatch: number;
  dropPct: number; // % liquidity drop from flagged value
  reason: string;
}

/** A verdict followed to a terminal outcome — the leakage-free backtest record. */
export interface ResolvedOutcome {
  address: string;
  symbol: string;
  name: string;
  verdict: Tier;
  topFlag: string;
  outcome: "rugged" | "survived";
  scoredAt: number;
  resolvedAt: number;
  hoursToResolve: number;
  liqAtScore: number;
  liqAtResolve: number;
  dropPct: number;
}

export interface TrackRecord {
  catches: RugCatch[];
  caughtCount: number;
  watchingCount: number;
  flaggedCount: number;
}

interface TierOutcome {
  resolved: number;
  rugged: number;
  survived: number;
}

/** The verifiable, point-in-time hit rate across all verdicts. */
export interface Scoreboard {
  avoid: TierOutcome & { ruggedWithin72h: number; precisionPct: number | null; watching: number };
  safe: TierOutcome & { cleanPct: number | null; watching: number }; // HOT + WATCH combined ("tradeable")
  byTier: Record<Tier, TierOutcome>;
  totalResolved: number;
  updatedAt: string;
}

/**
 * Snapshot launches at score time (fire-and-forget). AVOID-with-rug-reason calls go
 * to the public-catch lane; HOT/WATCH calls go to the scoreboard lane. NX semantics
 * keep the ORIGINAL snapshot — re-scoring the same token won't overwrite or re-queue it.
 */
export function recordCandidates(launches: ScoredLaunch[], now: number = Date.now()): void {
  if (!analyticsEnabled) return;
  const cmds: string[][] = [];
  for (const l of launches) {
    const liq = l.liquidityUsd ?? 0;
    if (liq < MIN_LIQ_TO_WATCH) continue;
    const addr = l.address.toLowerCase();

    if (l.tier === "AVOID") {
      // Public-catch lane: only AVOIDs with a credible "this will rug" danger flag.
      const danger = l.flags.find((f) => f.severity === "danger" && RUG_FLAGS.has(f.code));
      if (!danger) continue;
      const rec: RugCandidate = {
        address: addr, symbol: l.symbol, name: l.name, dex: l.dex,
        verdict: "AVOID", scoredAt: now, liqAtScore: Math.round(liq),
        priceAtScore: l.priceUsd, topFlag: danger.code,
      };
      cmds.push(["SET", `rugwatch:rec:${addr}`, JSON.stringify(rec), "NX"]);
      cmds.push(["ZADD", "rugwatch:watch", "NX", String(now), addr]);
    } else {
      // Scoreboard lane: follow HOT/WATCH calls to confirm we don't bless rugs.
      const top = l.flags[0]?.code ?? "";
      const rec: RugCandidate = {
        address: addr, symbol: l.symbol, name: l.name, dex: l.dex,
        verdict: l.tier, scoredAt: now, liqAtScore: Math.round(liq),
        priceAtScore: l.priceUsd, topFlag: top,
      };
      cmds.push(["SET", `rugwatch:orec:${addr}`, JSON.stringify(rec), "NX"]);
      cmds.push(["ZADD", "rugwatch:owatch", "NX", String(now), addr]);
    }
  }
  if (cmds.length) track(cmds);
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const parse = <T>(v: unknown): T | null => {
  const s = str(v);
  if (!s) return null;
  try { return JSON.parse(s) as T; } catch { return null; }
};

/** Current liquidity for a token, or null if its pool is gone. Throws on transient error. */
async function currentLiquidity(addr: string): Promise<number | null> {
  const pair = primaryPair(await getPairsForToken(addr));
  return pair ? (pair.liquidity?.usd ?? 0) : null; // null pair ⇒ pool gone
}

/** Best-effort: tie a confirmed rug's deployer to the reputation denylist. */
async function seedReputation(addr: string, now: number): Promise<void> {
  try {
    const deployer = await resolveDeployerAddress(addr as Address);
    if (deployer) {
      flagWallets([{ addr: deployer, role: "deployer", reason: "deployer of confirmed rug", token: addr }], now);
    }
  } catch {
    /* reputation seeding is best-effort */
  }
}

/** Stat-counter + backtest-log writes for a terminal outcome. */
function resolveWrites(rec: RugCandidate, outcome: "rugged" | "survived", liqAtResolve: number, now: number): string[][] {
  const dropPct = rec.liqAtScore > 0 ? Math.max(0, Math.round((1 - liqAtResolve / rec.liqAtScore) * 100)) : 0;
  const resolved: ResolvedOutcome = {
    address: rec.address, symbol: rec.symbol, name: rec.name, verdict: rec.verdict, topFlag: rec.topFlag,
    outcome, scoredAt: rec.scoredAt, resolvedAt: now,
    hoursToResolve: Math.round((now - rec.scoredAt) / 3_600_000),
    liqAtScore: rec.liqAtScore, liqAtResolve: Math.round(liqAtResolve), dropPct,
  };
  const w: string[][] = [
    ["INCR", `rugwatch:stat:${outcome}:${rec.verdict}`],
    ["SET", `rugwatch:resolved:${rec.address}`, JSON.stringify(resolved)],
    ["ZADD", "rugwatch:resolved", String(now), rec.address],
    ["ZREMRANGEBYRANK", "rugwatch:resolved", "0", String(-RESOLVED_CAP - 1)],
  ];
  if (outcome === "rugged" && rec.verdict === "AVOID" && now - rec.scoredAt <= RUG_72H_MS) {
    w.push(["INCR", "rugwatch:stat:rugged72h:AVOID"]);
  }
  return w;
}

/**
 * Recheck the oldest AVOID candidates (public-catch lane): confirm rugs (liquidity
 * collapse / pool gone), promote to the public track record, and retire survivors.
 * Increments scoreboard counters at terminal time. Returns counts. Bounded per call.
 */
export async function recheckWatched(limit = 20, now: number = Date.now()): Promise<{ caught: number; retired: number; checked: number }> {
  if (!analyticsEnabled) return { caught: 0, retired: 0, checked: 0 };

  const res = await redisExec([["ZRANGE", "rugwatch:watch", "0", String(limit - 1)]]);
  const addrs = (res[0]?.result as string[] | undefined) ?? [];
  if (addrs.length === 0) return { caught: 0, retired: 0, checked: 0 };

  const recRes = await redisExec(addrs.map((a) => ["GET", `rugwatch:rec:${a}`]));
  let caught = 0;
  let retired = 0;
  const writes: string[][] = [];

  for (let i = 0; i < addrs.length; i++) {
    const addr = addrs[i];
    const rec = parse<RugCandidate>(recRes[i]?.result);
    if (!rec) { writes.push(["ZREM", "rugwatch:watch", addr]); retired++; continue; }
    if (!rec.verdict) rec.verdict = "AVOID"; // legacy snapshots predate the verdict field

    let curLiq: number | null;
    try {
      curLiq = await currentLiquidity(addr);
    } catch {
      continue; // transient fetch error → leave it watched for next pass
    }

    const rugged = curLiq === null || curLiq < rec.liqAtScore * RUG_LIQ_FRACTION;
    if (rugged) {
      const liqAtCatch = curLiq ?? 0;
      const dropPct = rec.liqAtScore > 0 ? Math.round((1 - liqAtCatch / rec.liqAtScore) * 100) : 100;
      const hit: RugCatch = {
        ...rec, caughtAt: now, liqAtCatch: Math.round(liqAtCatch), dropPct,
        reason: curLiq === null ? "pool removed" : `liquidity −${dropPct}%`,
      };
      writes.push(["SET", `rugwatch:caught:${addr}`, JSON.stringify(hit)]);
      writes.push(["ZADD", "rugwatch:caught", String(now), addr]);
      writes.push(["ZREM", "rugwatch:watch", addr]);
      writes.push(...resolveWrites(rec, "rugged", liqAtCatch, now));
      caught++;
      await seedReputation(addr, now);
    } else if (now - rec.scoredAt > MAX_WATCH_AGE_MS) {
      // Survived the watch window without rugging — terminal "survived" outcome.
      writes.push(["ZREM", "rugwatch:watch", addr]);
      writes.push(...resolveWrites(rec, "survived", curLiq ?? 0, now));
      retired++;
    }
  }

  if (writes.length) await redisExec(writes);
  return { caught, retired, checked: addrs.length };
}

/**
 * Recheck the oldest HOT/WATCH calls (scoreboard lane): follow each to a terminal
 * outcome so the public hit rate covers our positive calls too. A HOT/WATCH that
 * rugs is a miss (counted, deployer denylisted) but NOT shown as a public "catch".
 */
export async function recheckOutcomes(limit = 40, now: number = Date.now()): Promise<{ rugged: number; survived: number; checked: number }> {
  if (!analyticsEnabled) return { rugged: 0, survived: 0, checked: 0 };

  const res = await redisExec([["ZRANGE", "rugwatch:owatch", "0", String(limit - 1)]]);
  const addrs = (res[0]?.result as string[] | undefined) ?? [];
  if (addrs.length === 0) return { rugged: 0, survived: 0, checked: 0 };

  const recRes = await redisExec(addrs.map((a) => ["GET", `rugwatch:orec:${a}`]));
  let rugged = 0;
  let survived = 0;
  const writes: string[][] = [];

  for (let i = 0; i < addrs.length; i++) {
    const addr = addrs[i];
    const rec = parse<RugCandidate>(recRes[i]?.result);
    if (!rec) { writes.push(["ZREM", "rugwatch:owatch", addr]); continue; }

    let curLiq: number | null;
    try {
      curLiq = await currentLiquidity(addr);
    } catch {
      continue;
    }

    const didRug = curLiq === null || curLiq < rec.liqAtScore * RUG_LIQ_FRACTION;
    if (didRug) {
      writes.push(["ZREM", "rugwatch:owatch", addr]);
      writes.push(...resolveWrites(rec, "rugged", curLiq ?? 0, now));
      rugged++;
      await seedReputation(addr, now); // a HOT/WATCH that rugged → still a bad deployer
    } else if (now - rec.scoredAt > MAX_WATCH_AGE_MS) {
      writes.push(["ZREM", "rugwatch:owatch", addr]);
      writes.push(...resolveWrites(rec, "survived", curLiq ?? 0, now));
      survived++;
    }
  }

  if (writes.length) await redisExec(writes);
  return { rugged, survived, checked: addrs.length };
}

/** Read the public track record: recent confirmed catches + headline counts. */
export async function getTrackRecord(limit = 50, now: number = Date.now()): Promise<TrackRecord> {
  if (!analyticsEnabled) return { catches: [], caughtCount: 0, watchingCount: 0, flaggedCount: 0 };
  void now;
  const meta = await redisExec([
    ["ZCARD", "rugwatch:caught"],
    ["ZCARD", "rugwatch:watch"],
    ["ZRANGE", "rugwatch:caught", "0", String(limit - 1), "REV"],
  ]);
  const caughtCount = Number(meta[0]?.result ?? 0);
  const watchingCount = Number(meta[1]?.result ?? 0);
  const addrs = (meta[2]?.result as string[] | undefined) ?? [];

  let catches: RugCatch[] = [];
  if (addrs.length) {
    const recs = await redisExec(addrs.map((a) => ["GET", `rugwatch:caught:${a}`]));
    catches = addrs.map((_, i) => parse<RugCatch>(recs[i]?.result)).filter((c): c is RugCatch => !!c);
  }
  return { catches, caughtCount, watchingCount, flaggedCount: caughtCount + watchingCount };
}

const pct = (num: number, den: number): number | null => (den > 0 ? Math.round((num / den) * 100) : null);

/**
 * The verifiable scoreboard: point-in-time hit rate across every verdict. Reads only
 * accumulated terminal-outcome counters, so it's leakage-free by construction.
 */
export async function getScoreboard(now: number = Date.now()): Promise<Scoreboard> {
  const empty: TierOutcome = { resolved: 0, rugged: 0, survived: 0 };
  if (!analyticsEnabled) {
    return {
      avoid: { ...empty, ruggedWithin72h: 0, precisionPct: null, watching: 0 },
      safe: { ...empty, cleanPct: null, watching: 0 },
      byTier: { AVOID: { ...empty }, WATCH: { ...empty }, HOT: { ...empty } },
      totalResolved: 0,
      updatedAt: new Date(now).toISOString(),
    };
  }
  const keys = [
    "rugwatch:stat:rugged:AVOID", "rugwatch:stat:survived:AVOID", "rugwatch:stat:rugged72h:AVOID",
    "rugwatch:stat:rugged:WATCH", "rugwatch:stat:survived:WATCH",
    "rugwatch:stat:rugged:HOT", "rugwatch:stat:survived:HOT",
  ];
  const res = await redisExec([
    ...keys.map((k) => ["GET", k]),
    ["ZCARD", "rugwatch:watch"],
    ["ZCARD", "rugwatch:owatch"],
  ]);
  const n = (i: number) => Number(res[i]?.result ?? 0);
  const aRug = n(0), aSurv = n(1), a72 = n(2), wRug = n(3), wSurv = n(4), hRug = n(5), hSurv = n(6);
  const avoidWatch = n(7), safeWatch = n(8);

  const tier = (rug: number, surv: number): TierOutcome => ({ resolved: rug + surv, rugged: rug, survived: surv });
  const AVOID = tier(aRug, aSurv);
  const WATCH = tier(wRug, wSurv);
  const HOT = tier(hRug, hSurv);
  const safeRug = wRug + hRug, safeSurv = wSurv + hSurv;

  return {
    avoid: { ...AVOID, ruggedWithin72h: a72, precisionPct: pct(aRug, aRug + aSurv), watching: avoidWatch },
    safe: { resolved: safeRug + safeSurv, rugged: safeRug, survived: safeSurv, cleanPct: pct(safeSurv, safeRug + safeSurv), watching: safeWatch },
    byTier: { AVOID, WATCH, HOT },
    totalResolved: aRug + aSurv + safeRug + safeSurv,
    updatedAt: new Date(now).toISOString(),
  };
}

/** Recent resolved outcomes — the leakage-free backtest log (newest first). */
export async function getResolvedOutcomes(limit = 100): Promise<ResolvedOutcome[]> {
  if (!analyticsEnabled) return [];
  const meta = await redisExec([["ZRANGE", "rugwatch:resolved", "0", String(limit - 1), "REV"]]);
  const addrs = (meta[0]?.result as string[] | undefined) ?? [];
  if (!addrs.length) return [];
  const recs = await redisExec(addrs.map((a) => ["GET", `rugwatch:resolved:${a}`]));
  return addrs.map((_, i) => parse<ResolvedOutcome>(recs[i]?.result)).filter((r): r is ResolvedOutcome => !!r);
}
