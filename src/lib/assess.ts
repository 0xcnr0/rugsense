import { type Address, type Abi } from "viem";
import { publicClient } from "./client";
import type { DexPair, Flag, CheckStatus, SafetyCheck } from "./types";
import { getOnchainSafety } from "./safety";
import { getHoneypotInfo, honeypotSignals } from "./honeypot";
import { fetchTransferLogs, getHolderConcentration, getSniperActivity, sniperSignals, getGraphCentrality, centralitySignals, getLpSecurity } from "./holders";
import { getV3LpLock } from "./v3lock";
import { getLockDuration, durationSignal, PERMANENT, type LockDuration } from "./lockduration";
import { getDeployerReputation, deployerConfigured } from "./deployer";
import { getFundingCluster, fundingSignals, fundingClusterConfigured } from "./funding";
import { reputationEnabled, checkWallets, reputationSignal } from "./reputation";

// Safety orchestrator: combine every signal source into one assessment with a
// transparent per-check breakdown and a confidence level. Sources:
//   - contract reads (safety.ts): mint/blacklist/pause selectors, ownership
//   - honeypot.is: honeypot verdict, buy/sell tax, source-verified, proxy
//   - holders.ts: holder concentration, LP secured (burn+lock)
// Cheap signals run first; the heavy Transfer-log reconstruction is skipped when a
// hard fail (honeypot) already settles the verdict, to spare RPC + latency.

export interface SafetyAssessment {
  scoreDelta: number;
  flags: Flag[];
  checks: SafetyCheck[];
  confidence: number; // 0-100: share of canonical checks with a definitive result
  partial: boolean;
  details: {
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
    sniperPct: number | null;
    firstBlockBuyers: number | null;
    fundingClusterSize: number | null;
    lpLockType: string | null;
    lpUnlocksInDays: number | null;
    deployer: string | null;
    deployerDeployments: number | null;
    deployerAgeDays: number | null;
    deployerPriorTokens: number | null;
    deployerPriorRugged: number | null;
  };
}

const SUPPLY_ABI = [
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const satisfies Abi;

const CANONICAL = [
  "honeypot",
  "tax",
  "verified",
  "proxy",
  "mint",
  "ownership",
  "trade_controls",
  "holder_concentration",
  "snipers",
  "centrality",
  "lp_secured",
] as const;

// Funding-cluster joins the canonical denominator only when its key is configured
// AND we have top holders to inspect (set per-assessment below).

export async function assessSafety(
  pair: DexPair,
  now: number = Date.now(),
  deep: boolean = true,
  // Etherscan-backed signals (deployer, funding-cluster) add a serialized network
  // cost. Enabled for the single-token "is this safe?" query; the bulk feed passes
  // false to protect its 60s budget (it still gets the cheap log-reuse signals).
  runEtherscan: boolean = true,
): Promise<SafetyAssessment> {
  const token = pair.baseToken.address as Address;
  const flags: Flag[] = [];
  const checks: SafetyCheck[] = [];
  let scoreDelta = 0;

  // ── Cheap signals first: contract reads + honeypot.is + deployer (parallel) ──
  // Deployer reputation is an extra HTTP signal (Etherscan), gated to deep launches
  // to bound API volume and only when a key is configured. It joins the canonical
  // set (and the confidence denominator) only when it actually runs.
  const runDeployer = deployerConfigured() && deep && runEtherscan;
  const [oc, hp, dep] = await Promise.all([
    getOnchainSafety(pair, now),
    getHoneypotInfo(token, now),
    runDeployer ? getDeployerReputation(token, now) : Promise.resolve(null),
  ]);
  scoreDelta += oc.scoreDelta;
  flags.push(...oc.flags);
  const hpSig = honeypotSignals(hp);
  scoreDelta += hpSig.scoreDelta;
  flags.push(...hpSig.flags);

  // honeypot.is-derived checks
  check(checks, "honeypot", hp.isHoneypot == null ? "unknown" : hp.isHoneypot ? "fail" : "pass");
  const tax = Math.max(hp.buyTax ?? 0, hp.sellTax ?? 0);
  check(
    checks,
    "tax",
    hp.sellTax == null ? "unknown" : tax >= 50 ? "fail" : tax > 10 ? "warn" : "pass",
    hp.sellTax == null ? undefined : `buy ${hp.buyTax}% / sell ${hp.sellTax}%`,
  );
  check(checks, "verified", hp.openSource == null ? "unknown" : hp.openSource ? "pass" : "warn");
  check(checks, "proxy", hp.isProxy == null ? "unknown" : hp.isProxy ? "warn" : "pass");
  // contract-read checks
  check(checks, "mint", oc.details.mintable == null ? "unknown" : oc.details.mintable ? "fail" : "pass");
  check(
    checks,
    "ownership",
    oc.details.ownershipRenounced == null ? "unknown" : oc.details.ownershipRenounced ? "pass" : "warn",
  );
  // Latent honeypot: owner-mutable trade controls. Inert when ownership is renounced.
  check(
    checks,
    "trade_controls",
    oc.details.mutableTradeControls == null
      ? "unknown"
      : oc.details.mutableTradeControls === false || oc.details.ownershipRenounced === true
        ? "pass"
        : "warn",
    oc.details.mutableTradeControls
      ? oc.details.ownershipRenounced === true
        ? "levers present but renounced (inert)"
        : "owner can alter sells/tax post-launch"
      : "no mutable trade controls",
  );
  // Deployer reputation (folded in here; ran in parallel above).
  if (runDeployer) {
    if (dep && dep.ok) {
      scoreDelta += dep.scoreDelta;
      flags.push(...dep.flags);
      check(checks, "deployer", dep.status, dep.detail);
    } else {
      check(checks, "deployer", "unknown", "deployer history unavailable");
    }
  }

  // ── Heavy signals: holder concentration + LP secured (skip if already a hard fail) ──
  // Skip the heavy log-reconstruction when it can't change the verdict (already a
  // honeypot) or when the launch is low-priority (deep=false) — saves RPC budget so
  // the checks that do run stay reliable on rate-limited endpoints.
  const skipHeavy = hp.isHoneypot === true || !deep;
  let top10Pct: number | null = null;
  let whaleCount: number | null = null;
  let lpSecuredPct: number | null = null;
  let sniperPct: number | null = null;
  let firstBlockBuyers: number | null = null;
  let clusterSize: number | null = null;
  let clusterActive = false; // funding-cluster check ran → joins confidence denominator
  let reputationActive = false; // wallet-reputation check ran → joins denominator
  let lpLockType: string | null = null;
  let lpUnlocksInDays: number | null = null;

  if (skipHeavy) {
    const reason = hp.isHoneypot === true ? "skipped (honeypot)" : "skipped (low-priority)";
    check(checks, "holder_concentration", "unknown", reason);
    check(checks, "snipers", "unknown", reason);
    check(checks, "centrality", "unknown", reason);
    check(checks, "lp_secured", "unknown", reason);
  } else {
    try {
      const latest = await publicClient.getBlockNumber();
      // Bound log queries to the token's lifetime; when creation time is unknown,
      // fall back to a wider window so the v3 position-Mint can still be found.
      const FALLBACK_MS = 12 * 60 * 60 * 1000;
      const ageMs = pair.pairCreatedAt ? Math.max(0, now - pair.pairCreatedAt) : FALLBACK_MS;
      const blocksBack = BigInt(Math.ceil(ageMs / 2000)) + 100n; // Base ~2s blocks + buffer
      const fromBlock = latest > blocksBack ? latest - blocksBack : 0n;

      const [tsTok, tsLp] = await publicClient.multicall({
        allowFailure: true,
        contracts: [
          { address: token, abi: SUPPLY_ABI, functionName: "totalSupply" },
          { address: pair.pairAddress as Address, abi: SUPPLY_ABI, functionName: "totalSupply" },
        ],
      });

      // Fetch the token's Transfer logs once; share across holder + sniper analysis.
      const totalSupply = tsTok.status === "success" ? (tsTok.result as bigint) : 0n;
      const tokenLogs = await fetchTransferLogs(token, fromBlock, latest);

      // Holder concentration
      const conc = getHolderConcentration(tokenLogs, pair.pairAddress, totalSupply);
      if (conc.ok) {
        top10Pct = conc.top10Pct;
        whaleCount = conc.whaleCount;
        const t = conc.top10Pct ?? 0;
        if (t > 70) {
          scoreDelta -= 25;
          flags.push({ code: "HIGH_CONCENTRATION", label: `Top-10 hold ${t.toFixed(0)}%`, severity: "danger" });
          check(checks, "holder_concentration", "fail", `top10 ${t.toFixed(0)}%`);
        } else if (t > 40) {
          scoreDelta -= 12;
          flags.push({ code: "CONCENTRATED", label: `Top-10 hold ${t.toFixed(0)}%`, severity: "warn" });
          check(checks, "holder_concentration", "warn", `top10 ${t.toFixed(0)}%`);
        } else {
          scoreDelta += 6;
          check(checks, "holder_concentration", "pass", `top10 ${t.toFixed(0)}%`);
        }
        if ((conc.whaleCount ?? 0) > 5) {
          flags.push({ code: "MANY_WHALES", label: `${conc.whaleCount} wallets > 5%`, severity: "warn" });
        }
      } else {
        check(checks, "holder_concentration", "unknown", "too many transfers to reconstruct");
      }

      // Sniper / bundle activity (reuses the same Transfer logs).
      const snipe = getSniperActivity(tokenLogs, pair.pairAddress, totalSupply);
      if (snipe.ok) {
        sniperPct = snipe.earlySupplyPct;
        firstBlockBuyers = snipe.firstBlockBuyers;
        const sSig = sniperSignals(snipe);
        scoreDelta += sSig.scoreDelta;
        flags.push(...sSig.flags);
        check(checks, "snipers", sSig.status, sSig.detail);
      } else {
        check(checks, "snipers", "unknown", "could not reconstruct early buys");
      }

      // Graph centrality (#5) — reuses the same Transfer logs.
      const cen = getGraphCentrality(tokenLogs, pair.pairAddress);
      if (cen.ok) {
        const cSig = centralitySignals(cen);
        scoreDelta += cSig.scoreDelta;
        flags.push(...cSig.flags);
        check(checks, "centrality", cSig.status, cSig.detail);
      } else {
        check(checks, "centrality", "unknown", "could not build transfer graph");
      }

      // Funding-source cluster (uses the top holders surfaced above).
      if (runEtherscan && fundingClusterConfigured() && conc.ok && conc.topHolders.length > 0) {
        clusterActive = true;
        const fc = await getFundingCluster(conc.topHolders);
        if (fc.ok) {
          clusterSize = fc.clusterSize;
          const fSig = fundingSignals(fc);
          scoreDelta += fSig.scoreDelta;
          flags.push(...fSig.flags);
          check(checks, "cluster", fSig.status, fSig.detail);
        } else {
          check(checks, "cluster", "unknown", "funding sources unresolved");
        }
      }

      // Wallet reputation (#1 — proprietary flywheel): is the deployer or any top
      // holder a wallet we've tied to a prior rug? Cheap Redis read; runs whenever
      // we have addresses to check (deployer on the Etherscan path, holders always).
      if (reputationEnabled()) {
        const toCheck = [dep?.details.deployer, ...(conc.ok ? conc.topHolders : [])].filter(
          (a): a is string => !!a,
        );
        if (toCheck.length > 0) {
          reputationActive = true;
          const hitMap = await checkWallets(toCheck);
          const hits = [...hitMap.entries()].map(([addr, rec]) => ({ addr, rec }));
          const rSig = reputationSignal(hits);
          scoreDelta += rSig.scoreDelta;
          flags.push(...rSig.flags);
          check(checks, "reputation", rSig.status, rSig.detail);
        }
      }

      // LP secured (burn + lock). v3 pools have no ERC20 LP supply → unknown.
      const lpTotal = tsLp.status === "success" ? (tsLp.result as bigint) : 0n;
      if (lpTotal > 0n) {
        const lp = await getLpSecurity(pair.pairAddress as Address, lpTotal, fromBlock, latest);
        if (lp.ok) {
          // Only burn + KNOWN lockers are provably secured. LP in an unknown contract
          // is NOT credited (an attacker can fake a "lock" with a self-owned contract).
          const provable = (lp.burnedPct ?? 0) + (lp.lockedVerifiedPct ?? 0);
          const unverified = lp.lockedUnverifiedPct ?? 0;
          lpSecuredPct = provable;
          if (provable >= 80) {
            // Provably secured here is burn / no-withdraw locker ⇒ permanent.
            lpLockType = "permanent";
            scoreDelta += 15;
            flags.push({ code: "LP_SECURED", label: `LP ${provable.toFixed(0)}% burned/locked (permanent)`, severity: "info" });
            check(checks, "lp_secured", "pass", `${provable.toFixed(0)}% provably secured · permanent`);
          } else if (provable >= 50) {
            lpLockType = "permanent";
            scoreDelta += 6;
            check(checks, "lp_secured", "warn", `${provable.toFixed(0)}% provably secured · permanent`);
          } else if (unverified >= 50) {
            // LP sits in an unknown contract — no safety credit, flagged for review.
            flags.push({ code: "LP_LOCK_UNVERIFIED", label: "LP in unknown contract (lock unverifiable)", severity: "warn" });
            check(checks, "lp_secured", "warn", `${unverified.toFixed(0)}% in unverified contract`);
          } else {
            scoreDelta -= 12;
            flags.push({ code: "LP_UNSECURED", label: "LP not burned/locked (pullable)", severity: "danger" });
            check(checks, "lp_secured", "fail", `${provable.toFixed(0)}% secured`);
          }
        } else {
          check(checks, "lp_secured", "unknown", "could not reconstruct LP holders");
        }
      } else {
        // v3 pool (no fungible LP): resolve the position-NFT owner instead.
        const v3 = await getV3LpLock(pair.pairAddress as Address, fromBlock, latest);
        if (v3.status === "burned" || v3.status === "locked_verified") {
          scoreDelta += 15;
          lpSecuredPct = 100;
          // Resolve lock durability: burns + Clanker no-withdraw lockers are permanent;
          // a registered time-locker would report its remaining duration here.
          const dur: LockDuration =
            v3.status === "burned" || !v3.owner
              ? PERMANENT
              : await getLockDuration(v3.owner, pair.pairAddress as Address, now);
          lpLockType = dur.type;
          lpUnlocksInDays = dur.unlocksInDays;
          const dSig = durationSignal(dur);
          scoreDelta += dSig.scoreDelta;
          if (dSig.flag) flags.push({ code: dSig.flag, label: dSig.detail, severity: "warn" });
          flags.push({ code: "LP_SECURED", label: `v3 LP ${v3.status} · ${dur.label}`, severity: "info" });
          check(checks, "lp_secured", dur.type === "timed" && (dur.unlocksInDays ?? 0) < 7 ? "warn" : "pass", `v3 position ${v3.status} · ${dur.label}`);
        } else if (v3.status === "locked_unverified") {
          flags.push({ code: "LP_LOCK_UNVERIFIED", label: "v3 LP in unknown contract (lock unverifiable)", severity: "warn" });
          check(checks, "lp_secured", "warn", "v3 position held by unverified contract");
        } else if (v3.status === "pullable") {
          scoreDelta -= 12;
          lpSecuredPct = 0;
          flags.push({ code: "LP_UNSECURED", label: "v3 LP owned by EOA (pullable)", severity: "danger" });
          check(checks, "lp_secured", "fail", "v3 position owned by EOA");
        } else {
          check(checks, "lp_secured", "unknown", "v3 — position owner unresolved");
        }
      }
    } catch {
      check(checks, "holder_concentration", "unknown", "rpc error");
      check(checks, "snipers", "unknown", "rpc error");
      check(checks, "centrality", "unknown", "rpc error");
      check(checks, "lp_secured", "unknown", "rpc error");
    }
  }

  const ran = checks.filter((c) => c.status !== "unknown").length;
  // Deployer + funding-cluster + reputation join the denominator only when they ran.
  const denom =
    CANONICAL.length + (runDeployer ? 1 : 0) + (clusterActive ? 1 : 0) + (reputationActive ? 1 : 0);
  const confidence = Math.round((ran / denom) * 100);
  // A definitive honeypot verdict alone is a high-certainty decision regardless of completeness.
  const effectiveConfidence = hp.isHoneypot != null ? Math.max(confidence, 75) : confidence;

  return {
    scoreDelta,
    flags,
    checks,
    confidence: effectiveConfidence,
    partial: effectiveConfidence < 50,
    details: {
      honeypot: hp.isHoneypot,
      buyTax: hp.buyTax,
      sellTax: hp.sellTax,
      verified: hp.openSource,
      proxy: hp.isProxy,
      mintable: oc.details.mintable,
      ownershipRenounced: oc.details.ownershipRenounced,
      top10Pct,
      whaleCount,
      lpSecuredPct,
      sniperPct,
      firstBlockBuyers,
      fundingClusterSize: clusterSize,
      lpLockType,
      lpUnlocksInDays,
      deployer: dep?.details.deployer ?? null,
      deployerDeployments: dep?.details.recentDeployments ?? null,
      deployerAgeDays: dep?.details.walletAgeDays ?? null,
      deployerPriorTokens: dep?.details.priorTokens ?? null,
      deployerPriorRugged: dep?.details.priorRugged ?? null,
    },
  };
}

function check(arr: SafetyCheck[], key: string, status: CheckStatus, detail?: string): void {
  arr.push({ key, status, detail });
}
