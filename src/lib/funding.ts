import { etherscan, etherscanConfigured, txlist } from "./etherscan";
import type { Flag } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Funding-source cluster (#3). Coordinated wallets — one entity controlling many
// addresses — are a core rug/insider pattern ("funded from the same source within
// minutes"). We take the token's top holders and resolve each wallet's funder
// (the sender of its first incoming native-value tx). When several top holders
// share ONE funder AND were funded in a tight time window, that's a coordinated
// cluster, not coincidence.
//
// False-positive guard: a shared CEX hot wallet funds millions of unrelated users,
// so a raw "same funder" match over-fires. We require a tight funding-time window
// (bundlers batch-fund their wallets) and let an extensible exchange allowlist
// exclude known hot wallets. Etherscan V2 (free key) — degrades to "unknown".
// ─────────────────────────────────────────────────────────────────────────────

const ZERO = "0x0000000000000000000000000000000000000000";
const MAX_HOLDERS_CHECKED = 6; // bound Etherscan call volume per token
const CLUSTER_WINDOW_MIN = 120; // shared-funding must be this tight to count as coordinated

// Known exchange / infra hot wallets on Base whose shared funding is NOT a cluster
// signal (they fund unrelated users). Extend with verified addresses only.
const KNOWN_FUNDERS: ReadonlySet<string> = new Set<string>(
  ([] as string[]).map((a) => a.toLowerCase()),
);

export function fundingClusterConfigured(): boolean {
  return etherscanConfigured();
}

export interface FundingCluster {
  ok: boolean;
  /** Largest set of top holders sharing one (non-exchange) funder. */
  clusterSize: number | null;
  funder: string | null;
  /** Minutes spanning the cluster's funding txs (tight = coordinated). */
  windowMinutes: number | null;
  checked: number;
}

const UNKNOWN: FundingCluster = { ok: false, clusterSize: null, funder: null, windowMinutes: null, checked: 0 };

/** First inbound native-value tx → who funded this wallet, and when (ms). */
async function resolveFunder(holder: string): Promise<{ funder: string; ts: number } | null> {
  const txs = await txlist(holder, "asc", 25);
  if (!txs) return null;
  const h = holder.toLowerCase();
  for (const t of txs) {
    if ((t.to ?? "").toLowerCase() === h && BigInt(t.value || "0") > 0n) {
      const funder = (t.from ?? "").toLowerCase();
      if (funder && funder !== ZERO) return { funder, ts: Number(t.timeStamp) * 1000 };
    }
  }
  return null;
}

/** Resolve funders for the top holders and find the largest tight-window cluster. */
export async function getFundingCluster(holders: string[]): Promise<FundingCluster> {
  if (!fundingClusterConfigured() || holders.length === 0) return UNKNOWN;

  const targets = holders.slice(0, MAX_HOLDERS_CHECKED);
  const resolved = await Promise.all(targets.map((h) => resolveFunder(h)));

  // Group funding timestamps by funder (skip known exchange hot wallets).
  const byFunder = new Map<string, number[]>();
  let checked = 0;
  for (const r of resolved) {
    if (!r) continue;
    checked++;
    if (KNOWN_FUNDERS.has(r.funder)) continue;
    const arr = byFunder.get(r.funder) ?? [];
    arr.push(r.ts);
    byFunder.set(r.funder, arr);
  }
  if (checked === 0) return UNKNOWN;

  // Largest cluster, then its funding-time span.
  let best: { funder: string; size: number; windowMinutes: number } | null = null;
  for (const [funder, tsArr] of byFunder) {
    const span = (Math.max(...tsArr) - Math.min(...tsArr)) / 60_000;
    if (!best || tsArr.length > best.size) best = { funder, size: tsArr.length, windowMinutes: span };
  }

  return {
    ok: true,
    clusterSize: best?.size ?? 1,
    funder: best && best.size >= 2 ? best.funder : null,
    windowMinutes: best?.windowMinutes ?? null,
    checked,
  };
}

/** Pure scoring of a funding cluster → delta + flags + check status + detail. */
export function fundingSignals(c: FundingCluster): {
  scoreDelta: number;
  flags: Flag[];
  status: "pass" | "warn" | "fail" | "unknown";
  detail: string;
} {
  if (!c.ok || c.clusterSize === null) {
    return { scoreDelta: 0, flags: [], status: "unknown", detail: "funding sources unresolved" };
  }
  const size = c.clusterSize;
  const tight = c.windowMinutes !== null && c.windowMinutes <= CLUSTER_WINDOW_MIN;

  if (size >= 4 && tight) {
    return {
      scoreDelta: -14,
      status: "fail",
      detail: `${size} top holders funded by one source within ${Math.round(c.windowMinutes!)}m`,
      flags: [{ code: "COORDINATED_WALLETS", label: `${size} top wallets share a funder`, severity: "danger" }],
    };
  }
  if (size >= 3 && tight) {
    return {
      scoreDelta: -7,
      status: "warn",
      detail: `${size} top holders share a funder (${Math.round(c.windowMinutes!)}m window)`,
      flags: [{ code: "COORDINATED_WALLETS", label: `${size} top wallets share a funder`, severity: "warn" }],
    };
  }
  return { scoreDelta: 0, flags: [], status: "pass", detail: `no funding cluster among ${c.checked} checked` };
}
