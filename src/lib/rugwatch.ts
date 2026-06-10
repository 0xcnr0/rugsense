import { track, redisExec, analyticsEnabled } from "./analytics";
import { getPairsForToken, primaryPair } from "./dexscreener";
import { resolveDeployerAddress } from "./deployer";
import { flagWallets } from "./reputation";
import type { Address } from "viem";
import type { ScoredLaunch } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Track-record ("rugs we caught before they rugged"). The moat made visible: when
// we score a launch AVOID with a dangerous reason, we snapshot it; a periodic
// recheck confirms which of those actually died (liquidity drained / pool gone /
// honeypot). Confirmed catches become public proof — the announcement asset that
// converts humans, and a recency/quality signal for agents.
//
// Storage: the same Upstash/Vercel-KV REST that powers analytics. No-op without
// credentials. Keys:
//   rugwatch:rec:<addr>     JSON snapshot of a flagged candidate
//   rugwatch:watch          ZSET (score = scoredAt ms) of candidates still watched
//   rugwatch:caught         ZSET (score = caughtAt ms) of confirmed catches
//   rugwatch:caught:<addr>  JSON of the confirmed catch
// ─────────────────────────────────────────────────────────────────────────────

const MIN_LIQ_TO_WATCH = 2_000; // only claim catches on tokens that had real liquidity
const RUG_LIQ_FRACTION = 0.35; // liquidity below this fraction of flagged value ⇒ rugged
const MAX_WATCH_AGE_MS = 7 * 24 * 60 * 60 * 1000; // survived a week ⇒ not a rug, stop watching

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
  scoredAt: number; // ms
  liqAtScore: number;
  priceAtScore: number | null;
  topFlag: string;
}

export interface RugCatch extends RugCandidate {
  caughtAt: number; // ms
  liqAtCatch: number;
  dropPct: number; // % liquidity drop from flagged value
  reason: string;
}

export interface TrackRecord {
  catches: RugCatch[];
  caughtCount: number;
  watchingCount: number;
  flaggedCount: number;
}

/**
 * Snapshot AVOID launches with a credible rug reason (fire-and-forget). NX semantics
 * keep the ORIGINAL flag-time snapshot — re-scoring the same token won't overwrite it.
 */
export function recordCandidates(launches: ScoredLaunch[], now: number = Date.now()): void {
  if (!analyticsEnabled) return;
  const cmds: string[][] = [];
  for (const l of launches) {
    const liq = l.liquidityUsd ?? 0;
    if (l.tier !== "AVOID" || liq < MIN_LIQ_TO_WATCH) continue;
    const danger = l.flags.find((f) => f.severity === "danger" && RUG_FLAGS.has(f.code));
    if (!danger) continue;
    const addr = l.address.toLowerCase();
    const rec: RugCandidate = {
      address: addr,
      symbol: l.symbol,
      name: l.name,
      dex: l.dex,
      scoredAt: now,
      liqAtScore: Math.round(liq),
      priceAtScore: l.priceUsd,
      topFlag: danger.code,
    };
    cmds.push(["SET", `rugwatch:rec:${addr}`, JSON.stringify(rec), "NX"]);
    cmds.push(["ZADD", "rugwatch:watch", "NX", String(now), addr]);
  }
  if (cmds.length) track(cmds);
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const parse = <T>(v: unknown): T | null => {
  const s = str(v);
  if (!s) return null;
  try { return JSON.parse(s) as T; } catch { return null; }
};

/**
 * Recheck the oldest watched candidates: confirm rugs (liquidity collapse / pool gone)
 * and retire long-survivors. Returns how many were newly caught. Bounded per call.
 */
export async function recheckWatched(limit = 20, now: number = Date.now()): Promise<{ caught: number; retired: number; checked: number }> {
  if (!analyticsEnabled) return { caught: 0, retired: 0, checked: 0 };

  const res = await redisExec([["ZRANGE", "rugwatch:watch", "0", String(limit - 1)]]);
  const addrs = (res[0]?.result as string[] | undefined) ?? [];
  if (addrs.length === 0) return { caught: 0, retired: 0, checked: 0 };

  // Pull each candidate's snapshot.
  const recRes = await redisExec(addrs.map((a) => ["GET", `rugwatch:rec:${a}`]));
  let caught = 0;
  let retired = 0;
  const writes: string[][] = [];

  for (let i = 0; i < addrs.length; i++) {
    const addr = addrs[i];
    const rec = parse<RugCandidate>(recRes[i]?.result);
    if (!rec) { writes.push(["ZREM", "rugwatch:watch", addr]); retired++; continue; }

    // Re-fetch current liquidity from DexScreener.
    let curLiq: number | null = null;
    try {
      const pair = primaryPair(await getPairsForToken(addr));
      curLiq = pair ? (pair.liquidity?.usd ?? 0) : null; // null pair ⇒ pool gone
    } catch {
      continue; // transient fetch error → leave it watched for next pass
    }

    const rugged = curLiq === null || curLiq < rec.liqAtScore * RUG_LIQ_FRACTION;
    if (rugged) {
      const liqAtCatch = curLiq ?? 0;
      const dropPct = rec.liqAtScore > 0 ? Math.round((1 - liqAtCatch / rec.liqAtScore) * 100) : 100;
      const hit: RugCatch = {
        ...rec,
        caughtAt: now,
        liqAtCatch: Math.round(liqAtCatch),
        dropPct,
        reason: curLiq === null ? "pool removed" : `liquidity −${dropPct}%`,
      };
      writes.push(["SET", `rugwatch:caught:${addr}`, JSON.stringify(hit)]);
      writes.push(["ZADD", "rugwatch:caught", String(now), addr]);
      writes.push(["ZREM", "rugwatch:watch", addr]);
      caught++;

      // Close the flywheel: tie this confirmed rug's deployer to the reputation
      // denylist so future launches by the same wallet are caught pre-emptively.
      try {
        const deployer = await resolveDeployerAddress(addr as Address);
        if (deployer) {
          flagWallets([{ addr: deployer, role: "deployer", reason: "deployer of confirmed rug", token: addr }], now);
        }
      } catch {
        /* reputation seeding is best-effort */
      }
    } else if (now - rec.scoredAt > MAX_WATCH_AGE_MS) {
      // Survived the watch window without rugging — stop tracking (not a confirmed rug).
      writes.push(["ZREM", "rugwatch:watch", addr]);
      retired++;
    }
  }

  if (writes.length) await redisExec(writes);
  return { caught, retired, checked: addrs.length };
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
