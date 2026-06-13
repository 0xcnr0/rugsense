import { NextResponse, type NextRequest } from "next/server";
import { isAddress } from "viem";
import { withX402 } from "@x402/next";
import { getPairsForToken, primaryPair } from "@/lib/dexscreener";
import { scoreLaunch } from "@/lib/scoring";
import { registerWatch } from "@/lib/watchalerts";
import { trackCall } from "@/lib/analytics";
import { x402Server, X402_ENABLED, X402_PAY_TO, X402_WATCH_PRICE, X402_NETWORK_CAIP2 } from "@/lib/x402";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/watch/{address}?callback={url}   ($0.05, one-time)
// Register a token for lifecycle monitoring. We re-score it on our schedule for the
// next 7 days and POST your callback the moment the verdict changes or a rug is in
// progress (liquidity collapse / pool removed). Push, not pull — the continuous
// monitoring a single scored read can't give you.
//
// Settles only on success: a bad address (400), no pool (404), or a missing/invalid
// callback (400) is not charged.
async function handler(req: NextRequest): Promise<NextResponse> {
  const segments = req.nextUrl.pathname.split("/").filter(Boolean);
  const address = segments[segments.length - 1] ?? "";
  const callback = req.nextUrl.searchParams.get("callback") ?? "";

  if (!isAddress(address)) {
    return NextResponse.json(
      { error: "invalid_address", message: "Provide a valid Base token address (0x + 40 hex)." },
      { status: 400 },
    );
  }
  if (!callback) {
    return NextResponse.json(
      { error: "missing_callback", message: "Provide ?callback=<https URL> to receive webhook alerts." },
      { status: 400 },
    );
  }

  const pair = primaryPair(await getPairsForToken(address));
  if (!pair) {
    return NextResponse.json(
      { error: "not_found", message: "No DEX pair found for this token on Base.", address },
      { status: 404 },
    );
  }

  const scored = scoreLaunch(pair);
  const reg = await registerWatch(address, callback, scored.tier, scored.liquidityUsd, scored.symbol);
  if (!reg.ok) {
    return NextResponse.json({ error: "watch_failed", message: reg.error, address }, { status: 400 });
  }
  trackCall("watch", [scored.tier]);
  return NextResponse.json(
    {
      chain: "base",
      registered: true,
      ...reg,
      watchWindowDays: 7,
      delivers: ["tier_change", "rug_alert"],
      notes: [
        "We POST your callback with a JSON body {event,address,symbol,prevTier,tier,liquidityUsd,dropPct,reason,firedAt} " +
          "on a verdict change or rug-in-progress, for 7 days.",
        "One-time fee covers the watch window. Not financial advice.",
      ],
    },
    { headers: { "cache-control": "no-store" } },
  );
}

function buildGet(): (req: NextRequest) => Promise<NextResponse> {
  if (!X402_ENABLED || !X402_PAY_TO) return handler;
  return withX402(
    handler,
    {
      accepts: {
        scheme: "exact",
        network: X402_NETWORK_CAIP2 as `eip155:${string}`,
        payTo: X402_PAY_TO,
        price: X402_WATCH_PRICE,
      },
      description:
        "Register a Base token for 7-day lifecycle monitoring. We POST your callback on a tier " +
        "change or rug-in-progress (liquidity collapse / pool removed). Push alerts, not polling.",
      serviceName: "RugSense — Lifecycle Watch",
    },
    x402Server,
  );
}

export const GET = buildGet();
