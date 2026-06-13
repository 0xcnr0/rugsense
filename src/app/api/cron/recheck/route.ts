import { NextResponse, type NextRequest } from "next/server";
import { recheckWatched, recheckOutcomes } from "@/lib/rugwatch";
import { runWatchAlerts } from "@/lib/watchalerts";
import { getCachedFeed } from "@/lib/feedcache";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/cron/recheck
// Self-building public track record (/caught). Two passes per run:
//   1. DISCOVER — refresh the scored feed so AVOID-with-rug-reason launches get
//      snapshotted (recordCandidates runs inside the feed refresh). This makes the
//      record accrue on a schedule even without paid feed traffic.
//   2. CONFIRM — recheck watched candidates and promote the ones that rugged.
// Triggered by Vercel Cron (see vercel.json) and runnable manually.
//
// Auth: when CRON_SECRET is set, requires `Authorization: Bearer <CRON_SECRET>`
// (Vercel Cron adds this header automatically). Without CRON_SECRET it's open
// (the endpoint only reads DexScreener + updates our own track record).
export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let discovered = 0;
  try {
    const feed = await getCachedFeed();
    discovered = feed.launches.length;
  } catch {
    /* discovery is best-effort; still run the confirm passes */
  }
  // CONFIRM passes: public-catch lane (AVOIDs), then the scoreboard lane (HOT/WATCH
  // outcomes), then deliver lifecycle webhooks to anyone watching a token.
  const result = await recheckWatched(40);
  const outcomes = await recheckOutcomes(40);
  const alerts = await runWatchAlerts(40);
  return NextResponse.json({ ok: true, discovered, ...result, outcomes, alerts, at: new Date().toISOString() });
}
