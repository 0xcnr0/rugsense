import { NextResponse } from "next/server";
import { getScoreboard, getTrackRecord } from "@/lib/rugwatch";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/track-record  (FREE — no x402)
// The verifiable, point-in-time hit rate of every RugSense verdict. Each snapshot is
// written at score time; outcomes are observed strictly later, so the numbers are
// leakage-free by construction (no post-collapse data inflates them).
//
// This is the differentiator a freshly-prompted agent + free scanners cannot make:
// an audited record of how our calls actually resolved. Free on purpose — it's the
// proof that makes the paid endpoints worth buying. Lightly cached.
export async function GET(): Promise<NextResponse> {
  const [board, tr] = await Promise.all([getScoreboard(), getTrackRecord(20)]);
  return NextResponse.json(
    {
      chain: "base",
      generatedAt: board.updatedAt,
      scoreboard: board,
      recentCatches: tr.catches.map((c) => ({
        address: c.address,
        symbol: c.symbol,
        verdict: c.verdict,
        topFlag: c.topFlag,
        scoredAt: new Date(c.scoredAt).toISOString(),
        caughtAt: new Date(c.caughtAt).toISOString(),
        dropPct: c.dropPct,
        reason: c.reason,
      })),
      notes: [
        "Point-in-time & leakage-free: every token was snapshotted at score time; its " +
          "outcome (rugged vs survived) was observed strictly afterward. avoid.precisionPct = " +
          "share of resolved AVOIDs that rugged; safe.cleanPct = share of resolved HOT/WATCH that did NOT rug.",
        "'Rugged' = liquidity fell below 35% of the value at score time, or the pool was removed.",
        "A risk filter, not a guarantee. Not financial advice.",
      ],
    },
    { headers: { "cache-control": "public, max-age=120, s-maxage=120" } },
  );
}
