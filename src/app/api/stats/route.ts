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
    "calls:quick",
    "calls:batch",
    "calls:watch",
    "calls:deployer",
    `calls:day:${day}`,
    "tier:HOT",
    "tier:WATCH",
    "tier:AVOID",
  ]);
  // Per-endpoint price (env-overridable, mirrors src/lib/x402.ts defaults).
  const priceFor: Record<string, number> = {
    feed: Number(process.env.X402_PRICE || "0.03"),
    token: Number(process.env.X402_PRICE || "0.03"),
    quick: Number(process.env.X402_QUICK_PRICE || "0.005"),
    batch: Number(process.env.X402_BATCH_PRICE || "0.10"),
    watch: Number(process.env.X402_WATCH_PRICE || "0.05"),
    deployer: Number(process.env.X402_DEPLOYER_PRICE || "0.02"),
  };
  const byEndpoint = {
    feed: c["calls:feed"] ?? 0,
    token: c["calls:token"] ?? 0,
    quick: c["calls:quick"] ?? 0,
    batch: c["calls:batch"] ?? 0,
    watch: c["calls:watch"] ?? 0,
    deployer: c["calls:deployer"] ?? 0,
  };
  const estRevenueUsd = +Object.entries(byEndpoint)
    .reduce((sum, [k, n]) => sum + n * (priceFor[k] ?? 0), 0)
    .toFixed(2);

  return NextResponse.json(
    {
      totalCalls: c["calls:total"] ?? 0,
      callsByEndpoint: byEndpoint,
      callsToday: c[`calls:day:${day}`] ?? 0,
      tiersServed: { HOT: c["tier:HOT"] ?? 0, WATCH: c["tier:WATCH"] ?? 0, AVOID: c["tier:AVOID"] ?? 0 },
      estRevenueUsd, // priced per-endpoint, not a flat rate
      generatedAt: new Date().toISOString(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
