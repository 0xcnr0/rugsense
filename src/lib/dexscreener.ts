import type { DexPair } from "./types";
import { discoverRecentLaunchTokens } from "./onchain";

// Thin client over DexScreener's free public API.
// Docs: https://docs.dexscreener.com/api/reference
//
// MVP data strategy (see plan Faz 0): bootstrap on DexScreener's free endpoints
// instead of running our own indexer. `token-profiles/latest` surfaces newly
// listed tokens; we filter to Base and enrich each with its pair data so the
// scoring engine has liquidity / volume / age / tx signals to work with.
// Later (Faz 1.5) a dedicated factory-event indexer replaces this for freshness.

const BASE_URL = "https://api.dexscreener.com";
const CHAIN = "base";

interface TokenProfile {
  chainId: string;
  tokenAddress: string;
  url?: string;
  description?: string;
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      // Route-level caching (cache-control + force-dynamic) governs freshness;
      // keep this fetch standard so it typechecks outside the Next runtime too.
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Newly listed token profiles, filtered to Base. */
export async function getLatestBaseTokenProfiles(): Promise<TokenProfile[]> {
  const data = await getJson<TokenProfile[]>(`${BASE_URL}/token-profiles/latest/v1`);
  if (!Array.isArray(data)) return [];
  return data.filter((p) => p.chainId === CHAIN && !!p.tokenAddress);
}

/** All pairs for a given Base token address. */
export async function getPairsForToken(tokenAddress: string): Promise<DexPair[]> {
  const data = await getJson<DexPair[]>(
    `${BASE_URL}/token-pairs/v1/${CHAIN}/${tokenAddress}`,
  );
  if (!Array.isArray(data)) return [];
  return data.filter((p) => p.chainId === CHAIN);
}

/** Pick the most liquid pair for a token (the one a trader/agent would route through). */
export function primaryPair(pairs: DexPair[]): DexPair | null {
  if (pairs.length === 0) return null;
  return [...pairs].sort(
    (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0),
  )[0];
}

/** Enrich a set of token addresses into their primary pairs (newest first). */
async function enrichToPairs(addresses: string[]): Promise<DexPair[]> {
  const pairs = await Promise.all(
    addresses.map(async (addr) => primaryPair(await getPairsForToken(addr))),
  );
  return pairs
    .filter((p): p is DexPair => p !== null)
    .sort((a, b) => (b.pairCreatedAt ?? 0) - (a.pairCreatedAt ?? 0));
}

/**
 * Fetch the freshest Base launches as primary pairs, newest first.
 *
 * Primary source: onchain DEX factory events (the real "new launch" signal).
 * Fallback: DexScreener's global token-profiles feed (sparse, but keeps the
 * endpoint useful if the RPC is unavailable). Both are enriched via DexScreener
 * per-token pair data for liquidity / volume / age / tx signals.
 */
export async function getRecentBaseLaunchPairs(limit = 20): Promise<DexPair[]> {
  const discovered = await discoverRecentLaunchTokens();
  if (discovered.length > 0) {
    const addresses = discovered.slice(0, limit).map((d) => d.address);
    const pairs = await enrichToPairs(addresses);
    if (pairs.length > 0) return pairs.slice(0, limit);
  }

  // Fallback: global profiles feed filtered to Base.
  const profiles = (await getLatestBaseTokenProfiles()).slice(0, limit);
  return enrichToPairs(profiles.map((p) => p.tokenAddress));
}
