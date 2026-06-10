import { parseAbiItem, getAddress, type Address } from "viem";
import { publicClient } from "./client";
import type { Flag } from "./types";

// Holder concentration (#4/#9), sniper/bundle activity (#2), and LP-lock (#1) by
// reconstructing balances from Transfer logs. Cheap for FRESH launches (our niche
// → few transfers); for older / busy tokens the range guard returns null =
// "unknown" (honest, lowers confidence). The token's Transfer logs are fetched
// ONCE (assess.ts) and shared across the holder + sniper analyses.

const TRANSFER = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);
const DEAD = "0x000000000000000000000000000000000000dead";
const ZERO = "0x0000000000000000000000000000000000000000";
const MAX_RANGE = 60_000n; // ~33h of Base blocks; beyond this we don't reconstruct

/** A decoded Transfer log (the subset we use). */
export interface TransferLog {
  from: string;
  to: string;
  value: bigint;
  blockNumber: bigint;
}

/** Fetch + decode Transfer logs for a contract. null if range too big or RPC fails. */
export async function fetchTransferLogs(
  address: Address,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<TransferLog[] | null> {
  if (toBlock - fromBlock > MAX_RANGE) return null;
  try {
    const logs = await publicClient.getLogs({ address, event: TRANSFER, fromBlock, toBlock });
    const out: TransferLog[] = [];
    for (const log of logs) {
      const { from, to, value } = log.args as { from?: string; to?: string; value?: bigint };
      if (!from || !to || value === undefined) continue;
      out.push({ from: from.toLowerCase(), to: to.toLowerCase(), value, blockNumber: log.blockNumber ?? 0n });
    }
    return out;
  } catch {
    return null;
  }
}

/** Fold Transfer logs into address→balance. */
function foldBalances(logs: TransferLog[]): Map<string, bigint> {
  const bal = new Map<string, bigint>();
  for (const { from, to, value } of logs) {
    if (from !== ZERO) bal.set(from, (bal.get(from) ?? 0n) - value); // mints (from ZERO) don't debit
    bal.set(to, (bal.get(to) ?? 0n) + value);
  }
  return bal;
}

const pctOf = (v: bigint, total: bigint): number =>
  total > 0n ? Number((v * 10000n) / total) / 100 : 0;

export interface HolderConcentration {
  ok: boolean;
  holderCount: number | null;
  topHolderPct: number | null;
  top10Pct: number | null;
  whaleCount: number | null; // wallets holding > 5% (excl. pool/burn)
  topHolders: string[]; // top holder addresses (excl. pool/burn), for cluster analysis
}

/** Top-holder concentration as a share of total supply, excluding the LP pool + burn. */
export function getHolderConcentration(
  logs: TransferLog[] | null,
  pairAddress: string,
  totalSupply: bigint,
): HolderConcentration {
  if (!logs || totalSupply === 0n) {
    return { ok: false, holderCount: null, topHolderPct: null, top10Pct: null, whaleCount: null, topHolders: [] };
  }
  const bal = foldBalances(logs);
  const exclude = new Set([pairAddress.toLowerCase(), DEAD, ZERO]);
  const holders = [...bal.entries()]
    .filter(([a, v]) => v > 0n && !exclude.has(a))
    .sort((a, b) => (b[1] > a[1] ? 1 : -1));

  const top10 = holders.slice(0, 10).reduce((s, [, v]) => s + v, 0n);
  return {
    ok: true,
    holderCount: holders.length,
    topHolderPct: holders.length ? pctOf(holders[0][1], totalSupply) : 0,
    top10Pct: pctOf(top10, totalSupply),
    whaleCount: holders.filter(([, v]) => pctOf(v, totalSupply) > 5).length,
    topHolders: holders.slice(0, 10).map(([a]) => a),
  };
}

export interface SniperActivity {
  ok: boolean;
  /** Supply (% of total) bought straight from the pool in the opening blocks. */
  earlySupplyPct: number | null;
  /** Distinct wallets that bought in the very first trading block (bundle proxy). */
  firstBlockBuyers: number | null;
  /** Distinct wallets buying inside the opening window. */
  earlyBuyers: number | null;
}

// Opening-window width: blocks after the first on-chain buy that still count as
// "snipe". ~6 Base blocks ≈ 12s — coordinated snipers/bundlers land here.
const SNIPE_WINDOW_BLOCKS = 6n;

/**
 * Sniper / bundle detection (#2): how much supply was grabbed from the pool in the
 * opening blocks, and how many wallets bought in the very first block (coordinated
 * bundle proxy). Buys = transfers whose sender is the LP pair. Pure analysis over
 * the already-fetched Transfer logs.
 */
export function getSniperActivity(
  logs: TransferLog[] | null,
  pairAddress: string,
  totalSupply: bigint,
): SniperActivity {
  if (!logs || totalSupply === 0n) {
    return { ok: false, earlySupplyPct: null, firstBlockBuyers: null, earlyBuyers: null };
  }
  const pair = pairAddress.toLowerCase();
  // Buys = pool → buyer (exclude router/pair-internal recipients).
  const buys = logs
    .filter((l) => l.from === pair && l.to !== pair && l.to !== ZERO && l.to !== DEAD && l.value > 0n)
    .sort((a, b) => (a.blockNumber > b.blockNumber ? 1 : a.blockNumber < b.blockNumber ? -1 : 0));
  if (buys.length === 0) {
    return { ok: true, earlySupplyPct: 0, firstBlockBuyers: 0, earlyBuyers: 0 };
  }
  const t0 = buys[0].blockNumber;
  const windowEnd = t0 + SNIPE_WINDOW_BLOCKS;
  const early = buys.filter((b) => b.blockNumber <= windowEnd);

  const earlySupply = early.reduce((s, b) => s + b.value, 0n);
  const firstBlockBuyers = new Set(buys.filter((b) => b.blockNumber === t0).map((b) => b.to)).size;
  const earlyBuyers = new Set(early.map((b) => b.to)).size;

  return {
    ok: true,
    earlySupplyPct: pctOf(earlySupply, totalSupply),
    firstBlockBuyers,
    earlyBuyers,
  };
}

/** Pure scoring of sniper/bundle activity → delta + flags + check status + detail. */
export function sniperSignals(s: SniperActivity): {
  scoreDelta: number;
  flags: Flag[];
  status: "pass" | "warn" | "fail" | "unknown";
  detail: string;
} {
  if (!s.ok || s.earlySupplyPct === null) {
    return { scoreDelta: 0, flags: [], status: "unknown", detail: "sniper activity unresolved" };
  }
  const flags: Flag[] = [];
  let scoreDelta = 0;
  const pct = s.earlySupplyPct;
  const bundle = (s.firstBlockBuyers ?? 0) >= 5;

  let status: "pass" | "warn" | "fail" = "pass";
  if (pct >= 25) {
    scoreDelta -= 18;
    status = "fail";
    flags.push({ code: "SNIPED", label: `Snipers took ${pct.toFixed(0)}% of supply at launch`, severity: "danger" });
  } else if (pct >= 12) {
    scoreDelta -= 9;
    status = "warn";
    flags.push({ code: "EARLY_CONCENTRATION", label: `${pct.toFixed(0)}% sniped in opening blocks`, severity: "warn" });
  }

  if (bundle) {
    scoreDelta -= 8;
    if (status === "pass") status = "warn";
    flags.push({ code: "BUNDLE", label: `${s.firstBlockBuyers} wallets bought in the first block`, severity: "warn" });
  }

  const detail = `${pct.toFixed(0)}% early · ${s.firstBlockBuyers ?? 0} first-block buyers`;
  return { scoreDelta, flags, status, detail };
}

export interface GraphCentrality {
  ok: boolean;
  /** Distinct recipients the most-connected non-pool wallet sent tokens to. */
  hubOutDegree: number | null;
  /** That hub's share of all holders (0-1) — high = star/insider distribution. */
  hubShare: number | null;
  holderCount: number | null;
  hub: string | null;
}

// A graph must have at least this many holders before centrality is meaningful.
const MIN_GRAPH_NODES = 12;

/**
 * Transaction-graph degree-centrality proxy (#5). RPHunter (arXiv 2506.18398):
 * rug/insider deployers sit at ~6× higher graph centrality. Cheap proxy over the
 * already-fetched Transfer logs: find the most-connected NON-pool wallet by
 * out-degree (distinct recipients it seeded). One wallet that funneled tokens out
 * to a large share of all holders is the "star" insider-distribution pattern that
 * organic launches (pool → many independent buyers) don't produce.
 */
export function getGraphCentrality(
  logs: TransferLog[] | null,
  pairAddress: string,
): GraphCentrality {
  if (!logs) return { ok: false, hubOutDegree: null, hubShare: null, holderCount: null, hub: null };
  const pair = pairAddress.toLowerCase();
  const skip = (a: string) => a === ZERO || a === DEAD || a === pair;

  const recipientsOf = new Map<string, Set<string>>(); // sender → distinct recipients
  const nodes = new Set<string>();
  for (const { from, to } of logs) {
    if (!skip(from)) nodes.add(from);
    if (!skip(to)) nodes.add(to);
    if (skip(from) || skip(to) || from === to) continue;
    const set = recipientsOf.get(from) ?? new Set<string>();
    set.add(to);
    recipientsOf.set(from, set);
  }
  const holderCount = nodes.size;
  if (holderCount < MIN_GRAPH_NODES) {
    // Too small to distinguish a star from normal early trading.
    return { ok: true, hubOutDegree: 0, hubShare: 0, holderCount, hub: null };
  }

  let hub: string | null = null;
  let hubOutDegree = 0;
  for (const [sender, recips] of recipientsOf) {
    if (recips.size > hubOutDegree) {
      hubOutDegree = recips.size;
      hub = sender;
    }
  }
  return { ok: true, hubOutDegree, hubShare: hubOutDegree / holderCount, holderCount, hub };
}

/** Pure scoring of graph centrality → delta + flags + check status + detail. */
export function centralitySignals(c: GraphCentrality): {
  scoreDelta: number;
  flags: Flag[];
  status: "pass" | "warn" | "fail" | "unknown";
  detail: string;
} {
  if (!c.ok || c.hubShare === null || c.hubOutDegree === null) {
    return { scoreDelta: 0, flags: [], status: "unknown", detail: "graph too small / unresolved" };
  }
  // Require an absolute hub size too, so a small graph can't trip on ratio alone.
  const significant = (c.hubOutDegree ?? 0) >= 6;
  if (significant && c.hubShare >= 0.5) {
    return {
      scoreDelta: -12,
      status: "fail",
      detail: `one wallet seeded ${Math.round(c.hubShare * 100)}% of holders`,
      flags: [{ code: "STAR_DISTRIBUTION", label: `Insider hub funded ${Math.round(c.hubShare * 100)}% of holders`, severity: "danger" }],
    };
  }
  if (significant && c.hubShare >= 0.3) {
    return {
      scoreDelta: -6,
      status: "warn",
      detail: `central wallet seeded ${Math.round(c.hubShare * 100)}% of holders`,
      flags: [{ code: "CENTRALIZED_GRAPH", label: `Hub wallet seeded ${Math.round(c.hubShare * 100)}% of holders`, severity: "warn" }],
    };
  }
  return { scoreDelta: 0, flags: [], status: "pass", detail: `hub ${Math.round((c.hubShare ?? 0) * 100)}% of ${c.holderCount} holders` };
}

// Known LP-locker contracts on Base. LP in a *known* locker is provably secured;
// LP in an *unknown* contract is NOT — an attacker can send LP to a contract they
// control to fake a "lock". Extend this allowlist with verified lockers only.
const KNOWN_LOCKERS: ReadonlySet<string> = new Set<string>(
  (
    [
      // UNCX / Team.Finance / PinkLock on Base — add verified addresses here.
    ] as string[]
  ).map((a) => a.toLowerCase()),
);

export interface LpSecurity {
  ok: boolean;
  /** Provably unrecoverable: sent to dead/zero. */
  burnedPct: number | null;
  /** Held by a KNOWN locker contract (provably locked). */
  lockedVerifiedPct: number | null;
  /** Held by some other contract — could be a real lock OR an attacker-controlled
   *  contract faking one. Treated as unverified (no safety credit). */
  lockedUnverifiedPct: number | null;
}

/**
 * LP security by reconstructing LP-token holders. Only BURN and KNOWN lockers count
 * as "secured" — LP held by an arbitrary contract is reported separately as
 * unverified, so the score can't be gamed by sending LP to a self-controlled contract.
 */
export async function getLpSecurity(
  pairAddress: Address,
  lpTotalSupply: bigint,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<LpSecurity> {
  const logs = await fetchTransferLogs(pairAddress, fromBlock, toBlock);
  if (!logs || lpTotalSupply === 0n) {
    return { ok: false, burnedPct: null, lockedVerifiedPct: null, lockedUnverifiedPct: null };
  }
  const bal = foldBalances(logs);
  const holders = [...bal.entries()]
    .filter(([, v]) => v > 0n)
    .sort((a, b) => (b[1] > a[1] ? 1 : -1))
    .slice(0, 10);

  let burned = 0n;
  let lockedVerified = 0n;
  let lockedUnverified = 0n;
  for (const [addr, v] of holders) {
    if (addr === DEAD || addr === ZERO) {
      burned += v;
      continue;
    }
    if (KNOWN_LOCKERS.has(addr)) {
      lockedVerified += v;
      continue;
    }
    try {
      const code = await publicClient.getCode({ address: getAddress(addr) });
      if (code && code.length > 2) lockedUnverified += v; // contract, but not a known locker
    } catch {
      /* ignore */
    }
  }
  return {
    ok: true,
    burnedPct: pctOf(burned, lpTotalSupply),
    lockedVerifiedPct: pctOf(lockedVerified, lpTotalSupply),
    lockedUnverifiedPct: pctOf(lockedUnverified, lpTotalSupply),
  };
}
