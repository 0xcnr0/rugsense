import { getPairsForToken, primaryPair } from "../src/lib/dexscreener";
import { assessSafety } from "../src/lib/assess";

// Calibrate the full safety assessment against known, established Base tokens.
// Proves honeypot.is + contract reads + holder/LP analysis line up sensibly.
// Run: npx tsx scripts/safety-demo.ts

const KNOWN: { sym: string; address: string }[] = [
  { sym: "AERO", address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631" },
  { sym: "DEGEN", address: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed" },
  { sym: "BRETT", address: "0x532f27101965dd16442E59d40670FaF5eBB142E4" },
];

(async () => {
  for (const t of KNOWN) {
    const pair = primaryPair(await getPairsForToken(t.address));
    if (!pair) {
      console.log(`${t.sym.padEnd(8)} no pair resolved`);
      continue;
    }
    const a = await assessSafety(pair);
    const d = a.details;
    console.log(
      `${t.sym.padEnd(8)} delta=${String(a.scoreDelta).padStart(4)} conf=${String(a.confidence).padStart(3)} | ` +
        `honeypot=${d.honeypot} tax(b/s)=${d.buyTax}/${d.sellTax} verified=${d.verified} proxy=${d.proxy} ` +
        `mint=${d.mintable} ownerRenounced=${d.ownershipRenounced} top10=${d.top10Pct ?? "n/a"}% lpSec=${d.lpSecuredPct ?? "n/a"}%`,
    );
    console.log(`         checks: ${a.checks.map((c) => `${c.key}:${c.status}`).join("  ")}`);
  }
})();
