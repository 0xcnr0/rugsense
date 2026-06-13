import { NextResponse, type NextRequest } from "next/server";
import { getResolvedOutcomes, getScoreboard } from "@/lib/rugwatch";
import type { Tier } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/history  (FREE — no x402)
// The leakage-free backtest log: every verdict RugSense made that has since resolved
// to a terminal outcome (rugged vs survived), with the call timestamp and the time it
// took to resolve. Each row was snapshotted at score time and graded strictly later —
// so an agent developer can verify the signal is worth paying for, with no post-hoc
// data leakage inflating it.
//
// Query: ?verdict=AVOID|WATCH|HOT  ?outcome=rugged|survived  ?limit=1-200 (default 100)
export async function GET(req: NextRequest): Promise<NextResponse> {
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(200, Math.max(1, Number(sp.get("limit")) || 100));
  const verdict = sp.get("verdict") as Tier | null;
  const outcome = sp.get("outcome");

  const [rows, board] = await Promise.all([getResolvedOutcomes(200), getScoreboard()]);
  let filtered = rows;
  if (verdict && ["AVOID", "WATCH", "HOT"].includes(verdict)) filtered = filtered.filter((r) => r.verdict === verdict);
  if (outcome === "rugged" || outcome === "survived") filtered = filtered.filter((r) => r.outcome === outcome);
  filtered = filtered.slice(0, limit);

  return NextResponse.json(
    {
      chain: "base",
      generatedAt: board.updatedAt,
      scoreboard: board,
      count: filtered.length,
      history: filtered,
      notes: [
        "Each row was snapshotted at scoredAt and graded at resolvedAt (strictly later) — " +
          "leakage-free. outcome='rugged' = liquidity fell below 35% of the value at score time, " +
          "or the pool was removed; 'survived' = still alive after a 7-day watch window.",
        "Use this to verify hit rate before paying. A risk filter, not a guarantee. Not financial advice.",
      ],
    },
    { headers: { "cache-control": "public, max-age=120, s-maxage=120" } },
  );
}
