// Shared domain types for RugSense.

/** A raw trading pair as returned by the DexScreener API (subset we use). */
export interface DexPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  url?: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceUsd?: string;
  liquidity?: { usd?: number; base?: number; quote?: number };
  volume?: { m5?: number; h1?: number; h6?: number; h24?: number };
  txns?: {
    m5?: { buys: number; sells: number };
    h1?: { buys: number; sells: number };
    h6?: { buys: number; sells: number };
    h24?: { buys: number; sells: number };
  };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number; // ms epoch
  info?: { socials?: { type: string; url: string }[]; websites?: { url: string }[] };
}

export type Tier = "HOT" | "WATCH" | "AVOID";

/** A single human/machine-readable risk-or-opportunity flag. */
export interface Flag {
  code: string; // machine-readable, e.g. "LOW_LIQUIDITY"
  label: string; // short human label
  severity: "info" | "warn" | "danger";
}

export type CheckStatus = "pass" | "warn" | "fail" | "unknown";

/** Transparent per-signal safety result — lets an agent audit *why* a score. */
export interface SafetyCheck {
  key: string; // e.g. "honeypot", "lp_secured", "holder_concentration"
  status: CheckStatus;
  detail?: string;
}

/** The scored launch — the product's core output. */
export interface ScoredLaunch {
  address: string; // base token address
  symbol: string;
  name: string;
  type: "token"; // future: "nft" | "miniapp"
  chain: "base";
  dex: string;
  pairAddress: string;
  ageMinutes: number | null;
  priceUsd: number | null;
  liquidityUsd: number | null;
  /** 0-100, higher = safer (lower trap/rug risk). Partial without onchain enrichment. */
  safetyScore: number;
  /** 0-100, higher = more early traction / interesting. */
  momentumScore: number;
  /** 0-100 composite, safety-gated. The number an agent gates decisions on. */
  composite: number;
  /** Direct action hint for an agent: HOT / WATCH / AVOID. */
  tier: Tier;
  flags: Flag[];
  /** True when key safety checks couldn't run (low confidence) — treat with caution. */
  safetyPartial: boolean;
  /** 0-100: share of canonical safety checks that produced a definitive result. */
  safetyConfidence: number;
  /** Transparent per-signal results (honeypot/tax/verified/proxy/mint/ownership/holders/LP). */
  checks: SafetyCheck[];
  /** Raw safety facts behind the checks. */
  safety?: {
    honeypot: boolean | null;
    buyTax: number | null;
    sellTax: number | null;
    verified: boolean | null;
    proxy: boolean | null;
    mintable: boolean | null;
    ownershipRenounced: boolean | null;
    top10Pct: number | null;
    whaleCount: number | null;
    lpSecuredPct: number | null;
    sniperPct?: number | null;
    firstBlockBuyers?: number | null;
    fundingClusterSize?: number | null;
    lpLockType?: string | null;
    lpUnlocksInDays?: number | null;
    deployer?: string | null;
    deployerDeployments?: number | null;
    deployerAgeDays?: number | null;
    deployerPriorTokens?: number | null;
    deployerPriorRugged?: number | null;
  };
  dexscreenerUrl?: string;
  scoredAt: string; // ISO timestamp
}

export interface LaunchesResponse {
  chain: "base";
  generatedAt: string;
  count: number;
  /** Note on data completeness (e.g. safety is partial pre-onchain-enrichment). */
  notes: string[];
  launches: ScoredLaunch[];
}
