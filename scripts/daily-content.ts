import { getRecentBaseLaunchPairs } from "../src/lib/dexscreener";
import { scoreLaunchesOnchain } from "../src/lib/scoring";
import type { ScoredLaunch } from "../src/lib/types";

// Generate a ready-to-post daily summary ("today's HOT Base launches + the rugs we
// filtered"). The product's output IS the marketing. This only PRINTS text — it does
// NOT post anywhere. Copy the output into Farcaster/X, or wire an auto-poster later.
//
// Run: npx tsx scripts/daily-content.ts        (uses BASE_RPC_URL if set)

function line(l: ScoredLaunch): string {
  const liq = l.liquidityUsd ? `$${Math.round(l.liquidityUsd / 1000)}k` : "—";
  const dangers = l.flags.filter((f) => f.severity === "danger").map((f) => f.code);
  const tag = dangers.length ? ` ⚠️ ${dangers.slice(0, 2).join(",")}` : "";
  return `${l.tier === "HOT" ? "🟢" : l.tier === "WATCH" ? "🟡" : "🔴"} $${l.symbol} — score ${l.composite} (safety ${l.safetyScore}/mom ${l.momentumScore}) · liq ${liq} · ${l.ageMinutes ?? "?"}m${tag}`;
}

(async () => {
  const all = (await scoreLaunchesOnchain(await getRecentBaseLaunchPairs(25))).sort(
    (a, b) => b.composite - a.composite,
  );
  const hot = all.filter((l) => l.tier === "HOT");
  const avoid = all.filter((l) => l.tier === "AVOID");

  const date = new Date().toISOString().slice(0, 10);
  const out: string[] = [];
  out.push(`📡 RugSense — ${date}`);
  out.push("");
  out.push(`Scanned ${all.length} fresh Base launches. Scored each for safety + momentum.`);
  out.push("");

  if (hot.length) {
    out.push(`🔥 HOT (${hot.length}):`);
    hot.slice(0, 5).forEach((l) => out.push(line(l)));
  } else {
    out.push("No HOT launches right now — mostly noise.");
  }
  out.push("");
  out.push(`🚮 Filtered ${avoid.length} as AVOID (low liquidity / honeypot / pullable LP / concentrated).`);
  const flaggedHoneypot = avoid.filter((l) => l.flags.some((f) => f.code === "HONEYPOT")).length;
  if (flaggedHoneypot) out.push(`   ${flaggedHoneypot} of them flagged as honeypots.`);
  out.push("");
  out.push("Scored decision in one x402 call → rugsense.xyz");
  out.push("#Base #x402 #onchain");

  const text = out.join("\n");
  console.log(text);
  console.log("\n— — —");
  console.log(`(chars: ${text.length}; trim for X's 280 if needed — Farcaster allows longer)`);
})();
