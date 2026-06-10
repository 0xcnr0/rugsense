import { scoreLaunch } from "../src/lib/scoring";
import { honeypotSignals, type HoneypotInfo } from "../src/lib/honeypot";
import { deployerSignals, deployerOutcomeSignal } from "../src/lib/deployer";
import { reputationSignal, type BadWallet } from "../src/lib/reputation";
import { getSniperActivity, sniperSignals, getGraphCentrality, centralitySignals, type TransferLog } from "../src/lib/holders";
import { fundingSignals, type FundingCluster } from "../src/lib/funding";
import { durationSignal, PERMANENT, type LockDuration } from "../src/lib/lockduration";
import { latentHoneypotSignal } from "../src/lib/safety";
import type { DexPair } from "../src/lib/types";

// Lightweight deterministic test suite for the scoring engine (no network, no deps).
// Run: npm test   → exits non-zero on failure.

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const NOW = 1_700_000_000_000;
function pair(over: Partial<DexPair> & { ageMin: number }): DexPair {
  const { ageMin, ...rest } = over;
  return {
    chainId: "base",
    dexId: "aerodrome",
    pairAddress: "0xpair",
    baseToken: { address: "0xtoken", name: "Demo", symbol: "DEMO" },
    quoteToken: { address: "0xweth", name: "WETH", symbol: "WETH" },
    priceUsd: "0.01",
    pairCreatedAt: NOW - ageMin * 60_000,
    ...rest,
  };
}

console.log("scoring — tiers");
const healthy = scoreLaunch(
  pair({ ageMin: 30, liquidity: { usd: 120_000 }, volume: { h1: 150_000 }, txns: { h1: { buys: 80, sells: 60 } } }),
  NOW,
);
check("healthy launch is not AVOID", healthy.tier !== "AVOID", `got ${healthy.tier}`);
check("healthy composite >= 45", healthy.composite >= 45, `got ${healthy.composite}`);

const thin = scoreLaunch(
  pair({ ageMin: 8, liquidity: { usd: 800 }, volume: { h1: 400 }, txns: { h1: { buys: 5, sells: 2 } } }),
  NOW,
);
check("thin-liquidity launch is AVOID", thin.tier === "AVOID", `got ${thin.tier}`);
check("thin launch has LOW_LIQUIDITY flag", thin.flags.some((f) => f.code === "LOW_LIQUIDITY"));

const noSells = scoreLaunch(
  pair({ ageMin: 12, liquidity: { usd: 30_000 }, volume: { h1: 20_000 }, txns: { h1: { buys: 40, sells: 0 } } }),
  NOW,
);
check("buys-but-no-sells flags NO_SELLS", noSells.flags.some((f) => f.code === "NO_SELLS"));
check("no-sells launch is AVOID (safety-gated)", noSells.tier === "AVOID", `got ${noSells.tier}`);

console.log("scoring — bounds & shape");
check("scores are 0-100", [healthy, thin, noSells].every((l) => l.composite >= 0 && l.composite <= 100 && l.safetyScore >= 0 && l.safetyScore <= 100));
check("partial flag set before onchain", healthy.safetyPartial === true);
check("checks empty before onchain", Array.isArray(healthy.checks) && healthy.checks.length === 0);

console.log("honeypot signals");
const hp = (over: Partial<HoneypotInfo>): HoneypotInfo => ({
  ok: true, isHoneypot: false, simulationSuccess: true, buyTax: 0, sellTax: 0,
  openSource: true, isProxy: false, riskLevel: 1, apiFlags: [], ...over,
});
check("honeypot → big negative delta", honeypotSignals(hp({ isHoneypot: true })).scoreDelta <= -50);
check("honeypot → HONEYPOT flag", honeypotSignals(hp({ isHoneypot: true })).flags.some((f) => f.code === "HONEYPOT"));
check("high sell tax → HIGH_TAX or worse", honeypotSignals(hp({ sellTax: 25 })).flags.some((f) => f.code === "HIGH_TAX" || f.code === "EXTREME_TAX"));
check("unverified → UNVERIFIED flag", honeypotSignals(hp({ openSource: false })).flags.some((f) => f.code === "UNVERIFIED"));
check("proxy → UPGRADEABLE flag", honeypotSignals(hp({ isProxy: true })).flags.some((f) => f.code === "UPGRADEABLE"));
check("clean token → no negative delta", honeypotSignals(hp({})).scoreDelta >= 0);
check("API down (ok:false) → no signal", honeypotSignals(hp({ ok: false })).scoreDelta === 0 && honeypotSignals(hp({ ok: false })).flags.length === 0);

console.log("deployer reputation signals");
check("serial deployer (>=8) → SERIAL_DEPLOYER + fail + negative", (() => {
  const s = deployerSignals(12, 0.5);
  return s.status === "fail" && s.scoreDelta < 0 && s.flags.some((f) => f.code === "SERIAL_DEPLOYER");
})());
check("multi-deployer (3-7) → MULTI_DEPLOYER + warn", (() => {
  const s = deployerSignals(4, 60);
  return s.status === "warn" && s.flags.some((f) => f.code === "MULTI_DEPLOYER");
})());
check("recidivism dominates wallet age", (() => {
  // A serial deployer on a 5-year-old wallet is still flagged serial, not "established".
  const s = deployerSignals(10, 1800);
  return s.flags.some((f) => f.code === "SERIAL_DEPLOYER");
})());
check("fresh throwaway wallet (<1d, low churn) → FRESH_DEPLOYER", (() => {
  const s = deployerSignals(0, 0.3);
  return s.status === "warn" && s.flags.some((f) => f.code === "FRESH_DEPLOYER");
})());
check("established low-churn wallet (>30d) → positive + pass", (() => {
  const s = deployerSignals(1, 200);
  return s.status === "pass" && s.scoreDelta > 0 && s.flags.some((f) => f.code === "ESTABLISHED_DEPLOYER");
})());
check("unknown history (nulls) → neutral, no flags", (() => {
  const s = deployerSignals(null, null);
  return s.scoreDelta === 0 && s.flags.length === 0;
})());

console.log("deployer prior-outcome (#2) signals");
check("mostly-rugged prior tokens → SERIAL_RUGGER + fail", (() => {
  const s = deployerOutcomeSignal(5, 4);
  return s?.status === "fail" && s.scoreDelta < 0 && s.flags.some((f) => f.code === "SERIAL_RUGGER");
})());
check("mixed prior record → MIXED_DEPLOYER_RECORD + warn", (() => {
  const s = deployerOutcomeSignal(5, 2);
  return s?.status === "warn" && s.flags.some((f) => f.code === "MIXED_DEPLOYER_RECORD");
})());
check("clean prior record → positive + pass", (() => {
  const s = deployerOutcomeSignal(4, 0);
  return s?.status === "pass" && s.scoreDelta > 0 && s.flags.some((f) => f.code === "CLEAN_DEPLOYER_RECORD");
})());
check("too few prior tokens → null (fall back to recidivism)", deployerOutcomeSignal(1, 1) === null && deployerOutcomeSignal(null, null) === null);

console.log("wallet-reputation (#1) signals");
const bw = (role: BadWallet["role"]): { addr: string; rec: BadWallet } => ({ addr: "0xbad", rec: { addr: "0xbad", role, reason: "deployer of confirmed rug", token: "0xt", at: 0 } });
check("flagged deployer → REPEAT_OFFENDER + force-AVOID delta", (() => {
  const s = reputationSignal([bw("deployer")]);
  return s.status === "fail" && s.scoreDelta <= -40 && s.flags.some((f) => f.code === "REPEAT_OFFENDER");
})());
check("flagged holder/funder → KNOWN_BAD_WALLETS + fail", (() => {
  const s = reputationSignal([bw("holder")]);
  return s.status === "fail" && s.flags.some((f) => f.code === "KNOWN_BAD_WALLETS");
})());
check("no hits → pass, no flags", (() => {
  const s = reputationSignal([]);
  return s.status === "pass" && s.scoreDelta === 0 && s.flags.length === 0;
})());

console.log("sniper / bundle signals");
const PAIR = "0xpair";
const tl = (from: string, to: string, value: bigint, block: bigint): TransferLog => ({ from, to, value, blockNumber: block });
const mint = tl("0x0000000000000000000000000000000000000000", PAIR, 1000n, 99n);

// One wallet snipes 30% straight from the pool in the opening block.
const sniped = getSniperActivity([mint, tl(PAIR, "0xaaa", 300n, 100n)], PAIR, 1000n);
check("sniped 30% → SNIPED + fail + negative", (() => {
  const s = sniperSignals(sniped);
  return s.status === "fail" && s.scoreDelta < 0 && s.flags.some((f) => f.code === "SNIPED");
})(), `pct=${sniped.earlySupplyPct}`);

// Six wallets buy in the first block (coordinated bundle), small amounts.
const bundleBuys = [mint, ...Array.from({ length: 6 }, (_, i) => tl(PAIR, `0xb${i}`, 10n, 100n))];
const bundled = getSniperActivity(bundleBuys, PAIR, 1000n);
check("6 first-block buyers → BUNDLE flag", (() => {
  const s = sniperSignals(bundled);
  return s.flags.some((f) => f.code === "BUNDLE") && (bundled.firstBlockBuyers ?? 0) === 6;
})(), `fbb=${bundled.firstBlockBuyers}`);

// Opening window excludes late buys: 5% early (block 100), 30% at block 110 (outside window).
const windowed = getSniperActivity([mint, tl(PAIR, "0xaaa", 50n, 100n), tl(PAIR, "0xbbb", 300n, 110n)], PAIR, 1000n);
check("opening window excludes late buys", windowed.earlySupplyPct === 5, `pct=${windowed.earlySupplyPct}`);

// Organic: one small early buy, no bundle → pass, no flags.
const clean = getSniperActivity([mint, tl(PAIR, "0xaaa", 20n, 100n)], PAIR, 1000n);
check("organic launch → pass, no sniper flags", (() => {
  const s = sniperSignals(clean);
  return s.status === "pass" && s.scoreDelta === 0 && s.flags.length === 0;
})());

check("no logs → unknown, no signal", (() => {
  const s = sniperSignals(getSniperActivity(null, PAIR, 1000n));
  return s.status === "unknown" && s.scoreDelta === 0;
})());

console.log("funding-cluster signals");
const fc = (over: Partial<FundingCluster>): FundingCluster => ({ ok: true, clusterSize: 1, funder: null, windowMinutes: null, checked: 5, ...over });
check("4 wallets, tight window → COORDINATED + fail", (() => {
  const s = fundingSignals(fc({ clusterSize: 4, funder: "0xf", windowMinutes: 30 }));
  return s.status === "fail" && s.scoreDelta < 0 && s.flags.some((f) => f.code === "COORDINATED_WALLETS");
})());
check("3 wallets, tight window → COORDINATED + warn", (() => {
  const s = fundingSignals(fc({ clusterSize: 3, funder: "0xf", windowMinutes: 45 }));
  return s.status === "warn" && s.flags.some((f) => f.code === "COORDINATED_WALLETS");
})());
check("shared funder but wide window (CEX FP guard) → pass", (() => {
  // 4 wallets share a funder but spread over 3 days → likely a CEX, not a bundle.
  const s = fundingSignals(fc({ clusterSize: 4, funder: "0xcex", windowMinutes: 4320 }));
  return s.status === "pass" && s.flags.length === 0;
})());
check("no cluster (size 1) → pass, no flags", (() => {
  const s = fundingSignals(fc({ clusterSize: 1, windowMinutes: 0 }));
  return s.status === "pass" && s.scoreDelta === 0 && s.flags.length === 0;
})());
check("unresolved (ok:false) → unknown", (() => {
  const s = fundingSignals(fc({ ok: false, clusterSize: null }));
  return s.status === "unknown" && s.scoreDelta === 0;
})());

console.log("graph-centrality signals");
// One hub seeds 10 wallets; a couple of unrelated edges → star distribution.
const starLogs = [
  ...Array.from({ length: 10 }, (_, i) => tl("0xhub", `0xr${i}`, 1n, 100n)),
  tl("0xaa", "0xbb", 1n, 100n),
  tl("0xcc", "0xdd", 1n, 100n),
];
check("hub seeds majority of holders → STAR_DISTRIBUTION + fail", (() => {
  const s = centralitySignals(getGraphCentrality(starLogs, PAIR));
  return s.status === "fail" && s.scoreDelta < 0 && s.flags.some((f) => f.code === "STAR_DISTRIBUTION");
})());
check("pool is excluded as hub (organic launch → pass)", (() => {
  // Pool → 15 independent buyers should NOT count the pool as an insider hub.
  const organic = Array.from({ length: 15 }, (_, i) => tl(PAIR, `0xbuyer${i}`, 1n, 100n));
  const s = centralitySignals(getGraphCentrality(organic, PAIR));
  return s.status === "pass" && s.flags.length === 0;
})());
check("graph too small → pass, no flags", (() => {
  const s = centralitySignals(getGraphCentrality([tl("0xaa", "0xbb", 1n, 100n)], PAIR));
  return s.status === "pass" && s.scoreDelta === 0;
})());
check("no logs → unknown", centralitySignals(getGraphCentrality(null, PAIR)).status === "unknown");

console.log("lock-duration signals");
const timed = (days: number): LockDuration => ({ type: "timed", unlocksInDays: days, label: `unlocks in ${days}d` });
check("permanent lock → full credit (no penalty)", durationSignal(PERMANENT).scoreDelta === 0 && durationSignal(PERMANENT).flag === null);
check("lock unlocking <7d → LP_UNLOCKS_SOON + penalty", (() => {
  const d = durationSignal(timed(3));
  return d.flag === "LP_UNLOCKS_SOON" && d.scoreDelta < 0;
})());
check("short lock <30d → LP_SHORT_LOCK + smaller penalty", (() => {
  const d = durationSignal(timed(20));
  return d.flag === "LP_SHORT_LOCK" && d.scoreDelta < 0 && d.scoreDelta > durationSignal(timed(3)).scoreDelta;
})());
check("long lock (>30d) → no penalty", durationSignal(timed(180)).scoreDelta === 0 && durationSignal(timed(180)).flag === null);

console.log("latent-honeypot (mutable trade controls) signals");
check("controls + active owner → MUTABLE_TRADE_CONTROLS + penalty", (() => {
  const s = latentHoneypotSignal(true, false);
  return s.scoreDelta < 0 && s.flag?.code === "MUTABLE_TRADE_CONTROLS";
})());
check("controls + renounced → inert, no penalty", (() => {
  const s = latentHoneypotSignal(true, true);
  return s.scoreDelta === 0 && s.flag?.code === "TRADE_CONTROLS_INERT";
})());
check("controls + unknown ownership → softer penalty", (() => {
  const s = latentHoneypotSignal(true, null);
  return s.scoreDelta < 0 && s.scoreDelta > latentHoneypotSignal(true, false).scoreDelta;
})());
check("no controls → no signal", (() => {
  const s = latentHoneypotSignal(false, false);
  return s.scoreDelta === 0 && s.flag === null;
})());

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
