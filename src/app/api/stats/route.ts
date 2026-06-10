import { NextResponse, type NextRequest } from "next/server";
import { readCounters, analyticsEnabled } from "@/lib/analytics";

export const dynamic = "force-dynamic";

// GET /api/stats?token=...  — private usage dashboard (paid-call counts + est. revenue).
// Free (not x402-gated). Locked by default: set STATS_TOKEN and pass it as ?token= to view,
// so call/revenue numbers aren't accidentally public.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const expected = process.env.STATS_TOKEN;
  const token = new URL(req.url).searchParams.get("token");
  if (!expected) {
    return NextResponse.json(
      { error: "locked", message: "Set the STATS_TOKEN env var, then call ?token=<it> to view stats." },
      { status: 403 },
    );
  }
  if (token !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!analyticsEnabled) {
    return NextResponse.json({
      analytics: "not_configured",
      hint: "Add UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL/TOKEN) to enable.",
    });
  }

  const day = new Date().toISOString().slice(0, 10);
  const c = await readCounters([
    "calls:total",
    "calls:feed",
    "calls:token",
    `calls:day:${day}`,
    "tier:HOT",
    "tier:WATCH",
    "tier:AVOID",
  ]);
  const price = Number(process.env.X402_PRICE || "0.03");

  return NextResponse.json(
    {
      totalCalls: c["calls:total"] ?? 0,
      feedCalls: c["calls:feed"] ?? 0,
      tokenCalls: c["calls:token"] ?? 0,
      callsToday: c[`calls:day:${day}`] ?? 0,
      tiersServed: { HOT: c["tier:HOT"] ?? 0, WATCH: c["tier:WATCH"] ?? 0, AVOID: c["tier:AVOID"] ?? 0 },
      estRevenueUsd: +((c["calls:total"] ?? 0) * price).toFixed(2),
      generatedAt: new Date().toISOString(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
