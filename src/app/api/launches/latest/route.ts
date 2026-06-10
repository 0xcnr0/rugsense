import { NextResponse, type NextRequest } from "next/server";
import { getCachedFeed } from "@/lib/feedcache";
import { trackCall } from "@/lib/analytics";
import type { LaunchesResponse, Tier } from "@/lib/types";

export const dynamic = "force-dynamic";
// Onchain safety fans out RPC calls per launch; give serverless room (Vercel Hobby max).
export const maxDuration = 60;

// GET /api/launches/latest  ?limit=20  ?tier=HOT|WATCH|AVOID  ?minSafety=60
//
// Plain handler. x402 v2 payment + Bazaar discovery are applied by the paymentProxy
// middleware (src/middleware.ts), which gates this path with the real route pattern
// (so the Bazaar routeTemplate matches the resource URL). This handler runs only after
// payment is satisfied (or always, when x402 is disabled).
export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const limit = clampInt(url.searchParams.get("limit"), 20, 1, 50);
  const tierFilter = url.searchParams.get("tier")?.toUpperCase() as Tier | undefined;
  const minSafety = clampInt(url.searchParams.get("minSafety"), 0, 0, 100);

  // Served from a short-TTL cache so polling agents are fast/cheap (see feedcache.ts).
  const { launches: all, at } = await getCachedFeed();
  let launches = [...all];

  if (tierFilter && ["HOT", "WATCH", "AVOID"].includes(tierFilter)) {
    launches = launches.filter((l) => l.tier === tierFilter);
  }
  if (minSafety > 0) {
    launches = launches.filter((l) => l.safetyScore >= minSafety);
  }
  launches.sort((a, b) => b.composite - a.composite);
  launches = launches.slice(0, limit);

  const body: LaunchesResponse = {
    chain: "base",
    generatedAt: new Date(at).toISOString(),
    count: launches.length,
    notes: [
      "safetyScore blends honeypot+tax simulation, source-verified & proxy (honeypot.is), " +
        "mint/blacklist/pause + ownership (onchain), holder concentration and LP burn/lock (v2 + v3). " +
        "Each launch carries a per-signal `checks[]` and `safetyConfidence`; `safetyPartial=true` " +
        "means key checks could not run (treat with caution).",
      "Discovery from onchain DEX factory events; market data from DexScreener free API. Not financial advice.",
    ],
    launches,
  };

  trackCall("feed", launches.map((l) => l.tier));
  return NextResponse.json(body, { headers: { "cache-control": "public, max-age=20" } });
}

function clampInt(raw: string | null, fallback: number, lo: number, hi: number): number {
  const n = raw ? parseInt(raw, 10) : NaN;
  if (Number.isNaN(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}
