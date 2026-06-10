import { type Address } from "viem";
import { publicClient } from "./client";
import { etherscan, etherscanConfigured, txlist, type TxRecord } from "./etherscan";
import { getPairsForToken, primaryPair } from "./dexscreener";
import { flagWallets } from "./reputation";
import type { Flag } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Deployer reputation (#1 — the highest-signal scoring gap from the research).
//
// A launch's risk correlates strongly with WHO deployed it. Cernera et al.
// (USENIX 2023): ~1% of creator addresses produce 20–25% of all tokens, and
// ~60% of those tokens live under a day — serial deployers are the rug engine.
// We resolve the deploying EOA (even through a launch factory) and score its
// track record: recidivism (how many contracts it has churned out) + wallet age
// (throwaway wallets funded minutes before the launch).
//
// Data source: Etherscan V2 unified API (chainid 8453 = Base) — a FREE key. When
// unconfigured we degrade to "unknown" (no score impact, not counted against
// confidence), matching the analytics/CDP graceful-degradation pattern.
// ─────────────────────────────────────────────────────────────────────────────

/** Is the deployer-reputation signal configured? (Etherscan V2 free key present.) */
export function deployerConfigured(): boolean {
  return etherscanConfigured();
}

interface CreationRecord {
  contractAddress: string;
  contractCreator: string;
  txHash: string;
}

/** Who created this contract (and the deploy tx) per Etherscan. null = unknown. */
async function getContractCreation(token: Address): Promise<CreationRecord | null> {
  const r = await etherscan<CreationRecord[]>({
    module: "contract",
    action: "getcontractcreation",
    contractaddresses: token,
  });
  return r && r.length > 0 ? r[0] : null;
}

/**
 * Resolve the deploying EOA for a token (the human behind a factory deploy too).
 * Shared by scoring and by the rug-confirm loop (rugwatch) so a confirmed rug can
 * flag its deployer into the reputation denylist. null when unresolvable.
 */
export async function resolveDeployerAddress(token: Address): Promise<string | null> {
  if (!etherscanConfigured()) return null;
  const creation = await getContractCreation(token);
  if (!creation) return null;
  let eoa = creation.contractCreator.toLowerCase();
  try {
    const tx = await publicClient.getTransaction({ hash: creation.txHash as `0x${string}` });
    if (tx?.from) eoa = tx.from.toLowerCase();
  } catch {
    /* fall back to contractCreator */
  }
  return eoa;
}

export interface DeployerReputation {
  ok: boolean;
  scoreDelta: number;
  flags: Flag[];
  status: "pass" | "warn" | "fail" | "unknown";
  detail: string;
  details: {
    deployer: string | null;
    /** Contract-creation txs seen in the deployer's recent history (recidivism proxy). */
    recentDeployments: number | null;
    walletAgeDays: number | null;
    factoryDeployed: boolean | null;
    /** Prior tokens by this deployer that we could check for an outcome. */
    priorTokens: number | null;
    /** Of those, how many are now dead (rugged) — the outcome signal (#2). */
    priorRugged: number | null;
  };
}

const UNKNOWN: DeployerReputation = {
  ok: false,
  scoreDelta: 0,
  flags: [],
  status: "unknown",
  detail: "deployer reputation unavailable",
  details: { deployer: null, recentDeployments: null, walletAgeDays: null, factoryDeployed: null, priorTokens: null, priorRugged: null },
};

const cache = new Map<string, { at: number; value: DeployerReputation }>();
const TTL_MS = 30 * 60_000; // deployer history changes slowly

/**
 * Resolve the deploying EOA and score its track record. Cheap (a few cached HTTP
 * calls) and high-signal. Returns UNKNOWN (no score impact) when the Etherscan
 * key is absent or the chain can't be resolved.
 */
export async function getDeployerReputation(
  token: Address,
  now: number = Date.now(),
): Promise<DeployerReputation> {
  if (!deployerConfigured()) return UNKNOWN;
  const cacheKey = token.toLowerCase();
  const hit = cache.get(cacheKey);
  if (hit && now - hit.at < TTL_MS) return hit.value;

  const value = await compute(token, now);
  cache.set(cacheKey, { at: now, value });
  return value;
}

async function compute(token: Address, now: number): Promise<DeployerReputation> {
  const creation = await getContractCreation(token);
  if (!creation) return UNKNOWN;

  // The creation record's `contractCreator` is the immediate creator — for a
  // factory-deployed token (Clanker/Zora) that's the factory contract, not the
  // human. Resolve the real EOA from the deploy tx's `from`.
  let eoa = creation.contractCreator.toLowerCase();
  let factoryDeployed = false;
  try {
    const tx = await publicClient.getTransaction({ hash: creation.txHash as `0x${string}` });
    if (tx?.from) {
      const sender = tx.from.toLowerCase();
      if (sender !== eoa) factoryDeployed = true; // creator != tx sender ⇒ via factory
      eoa = sender;
    }
  } catch {
    /* keep contractCreator as the deployer if the tx read fails */
  }

  // Recent history (recidivism density) + wallet age (throwaway detection).
  const [recent, firstTxArr] = await Promise.all([
    txlist(eoa, "desc", 100),
    txlist(eoa, "asc", 1),
  ]);

  let recentDeployments: number | null = null;
  if (recent) {
    // Contract-creation txs have an empty `to` and a populated contractAddress.
    recentDeployments = recent.filter((t) => (t.to ?? "") === "" && t.contractAddress).length;
  }

  let walletAgeDays: number | null = null;
  if (firstTxArr && firstTxArr.length > 0) {
    const firstTs = Number(firstTxArr[0].timeStamp) * 1000;
    if (Number.isFinite(firstTs) && firstTs > 0) {
      walletAgeDays = Math.max(0, (now - firstTs) / 86_400_000);
    }
  }

  const short = eoa.slice(0, 6) + "…" + eoa.slice(-4);

  // No usable history at all (txlist throttled): report the address, stay unknown.
  if (recentDeployments === null && walletAgeDays === null) {
    return {
      ...UNKNOWN,
      ok: true,
      detail: `deployer ${short} (history unavailable)`,
      details: { deployer: eoa, recentDeployments: null, walletAgeDays: null, factoryDeployed, priorTokens: null, priorRugged: null },
    };
  }

  // ② Prior-token OUTCOMES — the strong signal: did this deployer's earlier tokens
  // actually rug? Reuses the already-fetched `recent` txlist (no extra Etherscan).
  const { priorTokens, priorRugged } = await scanPriorOutcomes(recent, token.toLowerCase());

  // Outcome signal dominates recidivism-count when we have enough prior outcomes.
  const outcome = deployerOutcomeSignal(priorTokens, priorRugged, short);
  const base = deployerSignals(recentDeployments, walletAgeDays, short);
  const chosen = outcome ?? base;

  const flags = [...chosen.flags];
  if (factoryDeployed) {
    flags.push({ code: "FACTORY_DEPLOYED", label: "Deployed via a launch factory", severity: "info" });
  }

  // Serial rugger ⇒ seed the proprietary reputation denylist with this deployer.
  if (outcome && outcome.status === "fail") {
    flagWallets([{ addr: eoa, role: "deployer", reason: outcome.detail, token: token.toLowerCase() }], now);
  }

  return {
    ok: true,
    scoreDelta: chosen.scoreDelta,
    flags,
    status: chosen.status,
    detail: chosen.detail,
    details: { deployer: eoa, recentDeployments, walletAgeDays, factoryDeployed, priorTokens, priorRugged },
  };
}

// How many of the deployer's prior token launches to verify, and the liquidity
// floor below which a once-traded token counts as dead/rugged.
const MAX_PRIOR_CHECKS = 6;
const DEAD_LIQ_USD = 1_000;

/** Check the outcomes of the deployer's prior token deployments via DexScreener. */
async function scanPriorOutcomes(
  recent: TxRecord[] | null,
  currentToken: string,
): Promise<{ priorTokens: number | null; priorRugged: number | null }> {
  if (!recent) return { priorTokens: null, priorRugged: null };
  const created = recent
    .filter((t) => (t.to ?? "") === "" && t.contractAddress)
    .map((t) => t.contractAddress.toLowerCase())
    .filter((a) => a && a !== currentToken);
  const targets = [...new Set(created)].slice(0, MAX_PRIOR_CHECKS);
  if (targets.length === 0) return { priorTokens: 0, priorRugged: 0 };

  let priorTokens = 0;
  let priorRugged = 0;
  await Promise.all(
    targets.map(async (addr) => {
      try {
        const pair = primaryPair(await getPairsForToken(addr));
        if (!pair) return; // never traded ⇒ not a token outcome we can judge
        priorTokens++;
        if ((pair.liquidity?.usd ?? 0) < DEAD_LIQ_USD) priorRugged++;
      } catch {
        /* skip on fetch error */
      }
    }),
  );
  return { priorTokens, priorRugged };
}

/**
 * Pure scoring of a deployer's prior-token OUTCOMES (#2). Returns null when there
 * aren't enough verifiable prior tokens to judge (caller falls back to recidivism).
 * A deployer whose earlier tokens mostly died is the strongest deployer signal.
 */
export function deployerOutcomeSignal(
  priorTokens: number | null,
  priorRugged: number | null,
  short = "deployer",
): { scoreDelta: number; flags: Flag[]; status: "pass" | "warn" | "fail" | "unknown"; detail: string } | null {
  if (priorTokens === null || priorRugged === null || priorTokens < 2) return null;
  const frac = priorRugged / priorTokens;
  if (frac >= 0.6) {
    return {
      scoreDelta: -28,
      status: "fail",
      detail: `serial rugger (${priorRugged}/${priorTokens} prior tokens dead)`,
      flags: [{ code: "SERIAL_RUGGER", label: `Deployer's prior tokens mostly rugged (${priorRugged}/${priorTokens})`, severity: "danger" }],
    };
  }
  if (frac >= 0.3) {
    return {
      scoreDelta: -12,
      status: "warn",
      detail: `mixed deployer record (${priorRugged}/${priorTokens} prior dead)`,
      flags: [{ code: "MIXED_DEPLOYER_RECORD", label: `${priorRugged}/${priorTokens} of deployer's prior tokens are dead`, severity: "warn" }],
    };
  }
  return {
    scoreDelta: 6,
    status: "pass",
    detail: `clean deployer record (${priorTokens - priorRugged}/${priorTokens} prior tokens alive · ${short})`,
    flags: [{ code: "CLEAN_DEPLOYER_RECORD", label: `Deployer's prior tokens still alive (${priorTokens - priorRugged}/${priorTokens})`, severity: "info" }],
  };
}

/**
 * Pure scoring of a deployer's track record → delta + flags + check status.
 * Worst-pattern first: serial recidivism dominates, then throwaway-wallet age,
 * then a modest positive for established low-churn wallets.
 */
export function deployerSignals(
  recentDeployments: number | null,
  walletAgeDays: number | null,
  short = "deployer",
): { scoreDelta: number; flags: Flag[]; status: DeployerReputation["status"]; detail: string } {
  if (recentDeployments !== null && recentDeployments >= 8) {
    return {
      scoreDelta: -16,
      status: "fail",
      detail: `serial deployer (${recentDeployments}+ recent deploys)`,
      flags: [{ code: "SERIAL_DEPLOYER", label: `Serial deployer — ${recentDeployments}+ recent contracts`, severity: "danger" }],
    };
  }
  if (recentDeployments !== null && recentDeployments >= 3) {
    return {
      scoreDelta: -8,
      status: "warn",
      detail: `multi-deployer (${recentDeployments} recent deploys)`,
      flags: [{ code: "MULTI_DEPLOYER", label: `Deployer made ${recentDeployments} recent contracts`, severity: "warn" }],
    };
  }
  if (walletAgeDays !== null && walletAgeDays < 1) {
    return {
      scoreDelta: -6,
      status: "warn",
      detail: `fresh deployer wallet (${walletAgeDays.toFixed(1)}d old)`,
      flags: [{ code: "FRESH_DEPLOYER", label: "Deployer wallet < 1 day old", severity: "warn" }],
    };
  }
  if (walletAgeDays !== null && walletAgeDays > 30) {
    return {
      scoreDelta: 4,
      status: "pass",
      detail: `established deployer (${Math.round(walletAgeDays)}d, low churn)`,
      flags: [{ code: "ESTABLISHED_DEPLOYER", label: "Established deployer wallet", severity: "info" }],
    };
  }
  return {
    scoreDelta: 0,
    status: "pass",
    detail: `deployer ${short}${walletAgeDays !== null ? `, ${Math.round(walletAgeDays)}d old` : ""}`,
    flags: [],
  };
}
