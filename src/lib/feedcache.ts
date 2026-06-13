import { getRecentBaseLaunchPairs } from "./dexscreener";
import { scoreLaunchesOnchain } from "./scoring";
import { recordCandidates } from "./rugwatch";
import { recordDeployers } from "./deployerstore";
import type { ScoredLaunch } from "./types";

// Short-TTL cache for the scored launch feed. The heavy work (onchain discovery +
// honeypot.is + holder/LP per launch) runs at most once per TTL — so polling agents get
// fast, consistent responses and we don't burn RPC / honeypot.is quota on every call.
// Concurrent requests during a refresh share one in-flight computation (no thundering herd).
// (Per-warm-instance memory cache; good enough for a polled API on serverless.)

const TTL_MS = 45_000;
const SIZE = 25; // cache a healthy set; the route slices to the requested limit

let cache: { at: number; launches: ScoredLaunch[] } | null = null;
let inflight: Promise<ScoredLaunch[]> | null = null;

export async function getCachedFeed(now: number = Date.now()): Promise<{ launches: ScoredLaunch[]; at: number }> {
  if (cache && now - cache.at < TTL_MS) return cache;

  if (!inflight) {
    inflight = (async () => {
      const pairs = await getRecentBaseLaunchPairs(SIZE);
      const launches = await scoreLaunchesOnchain(pairs);
      cache = { at: Date.now(), launches };
      // Snapshot launches for the track record + scoreboard, and accumulate the
      // deployer dossier graph (both fire-and-forget; no-op without analytics creds).
      recordCandidates(launches);
      recordDeployers(launches);
      return launches;
    })().finally(() => {
      inflight = null;
    });
  }

  const launches = await inflight;
  return cache ?? { at: now, launches };
}
