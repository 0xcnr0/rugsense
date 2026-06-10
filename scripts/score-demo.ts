import { scoreLaunch } from "../src/lib/scoring";
import type { DexPair } from "../src/lib/types";

// Deterministic sanity check for the scoring engine (no network).
// Run: npm run score:demo

const NOW = 1_700_000_000_000; // fixed clock for reproducibility

function pair(over: Partial<DexPair> & { ageMin: number }): DexPair {
  const { ageMin, ...rest } = over;
  return {
    chainId: "base",
    dexId: "aerodrome",
    pairAddress: "0xpair",
    url: "https://dexscreener.com/base/0xpair",
    baseToken: { address: "0xtoken", name: "Demo", symbol: "DEMO" },
    quoteToken: { address: "0xweth", name: "WETH", symbol: "WETH" },
    priceUsd: "0.01",
    pairCreatedAt: NOW - ageMin * 60_000,
    ...rest,
  };
}

const cases: Record<string, DexPair> = {
  "healthy HOT launch": pair({
    ageMin: 30,
    liquidity: { usd: 120_000 },
    volume: { h1: 150_000 },
    txns: { h1: { buys: 80, sells: 60 } },
    info: { socials: [{ type: "twitter", url: "x.com/demo" }] },
  }),
  "honeypot (buys, no sells)": pair({
    ageMin: 12,
    liquidity: { usd: 30_000 },
    volume: { h1: 20_000 },
    txns: { h1: { buys: 40, sells: 0 } },
  }),
  "rug-thin liquidity": pair({
    ageMin: 8,
    liquidity: { usd: 800 },
    volume: { h1: 400 },
    txns: { h1: { buys: 5, sells: 2 } },
  }),
  "mid WATCH": pair({
    ageMin: 90,
    liquidity: { usd: 25_000 },
    volume: { h1: 8_000 },
    txns: { h1: { buys: 18, sells: 14 } },
  }),
};

for (const [label, p] of Object.entries(cases)) {
  const s = scoreLaunch(p, NOW);
  const flags = s.flags.map((f) => f.code).join(", ") || "none";
  console.log(
    `${label.padEnd(28)} → ${s.tier.padEnd(6)} composite=${String(s.composite).padStart(3)} ` +
      `safety=${String(s.safetyScore).padStart(3)} momentum=${String(s.momentumScore).padStart(3)} [${flags}]`,
  );
}
