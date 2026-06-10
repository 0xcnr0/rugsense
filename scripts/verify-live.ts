import { getRecentBaseLaunchPairs } from "../src/lib/dexscreener";
import { scoreLaunchesOnchain } from "../src/lib/scoring";

// Live end-to-end: onchain discovery → DexScreener enrich → scoring + ONCHAIN safety.
// Run: npx tsx scripts/verify-live.ts
(async () => {
  console.log("Discovering recent Base launches + running onchain safety…");
  const pairs = await getRecentBaseLaunchPairs(10);
  console.log(`Resolved ${pairs.length} pairs.`);
  if (pairs.length === 0) {
    console.log("No pairs resolved (no fresh Base tokens with DexScreener pairs right now).");
    return;
  }
  const scored = (await scoreLaunchesOnchain(pairs)).sort((a, b) => b.composite - a.composite);
  for (const l of scored.slice(0, 10)) {
    const s = l.safety;
    const safetyStr = `hp=${s?.honeypot ?? "?"} tax=${s?.sellTax ?? "?"} top10=${s?.top10Pct ?? "?"}% lpSec=${s?.lpSecuredPct ?? "?"}%`;
    console.log(
      `${(l.symbol || "?").padEnd(10)} ${l.tier.padEnd(6)} c=${String(l.composite).padStart(3)} ` +
        `s=${String(l.safetyScore).padStart(3)} m=${String(l.momentumScore).padStart(3)} conf=${String(l.safetyConfidence).padStart(3)} ` +
        `liq=${l.liquidityUsd ? "$" + Math.round(l.liquidityUsd).toLocaleString() : "—"} ` +
        `age=${l.ageMinutes ?? "—"}m | ${safetyStr} | [${l.flags.map((f) => f.code).join(",") || "none"}]`,
    );
  }
})();
