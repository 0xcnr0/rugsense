import { NextResponse, type NextRequest } from "next/server";
import { isAddress } from "viem";
import { withX402 } from "@x402/next";
import { getPairsForToken, primaryPair } from "@/lib/dexscreener";
import { scoreLaunchOnchain } from "@/lib/scoring";
import { trackCall } from "@/lib/analytics";
import { x402Server, X402_ENABLED, X402_PAY_TO, X402_PRICE, X402_NETWORK_CAIP2 } from "@/lib/x402";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/token/{address}
// Score one specific Base token on demand — the "is THIS token safe?" query an agent
// runs before a swap. Returns the full scored assessment (safety + momentum → tier,
// per-signal checks, confidence). Same engine as the launch feed.
//
// Uses route-level withX402 (settles ONLY on a successful <400 response), so an invalid
// address (400) or a token with no pool (404) is NOT charged. Independent of the /latest
// middleware — this endpoint doesn't touch that path.
async function handler(req: NextRequest): Promise<NextResponse> {
  // withX402 forwards only `request`, so read the address from the path.
  const address = req.nextUrl.pathname.split("/").filter(Boolean).pop() ?? "";

  if (!isAddress(address)) {
    return NextResponse.json(
      { error: "invalid_address", message: "Provide a valid Base token address (0x + 40 hex)." },
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

  const token = await scoreLaunchOnchain(pair);
  trackCall("token", [token.tier]);
  return NextResponse.json(
    {
      chain: "base",
      generatedAt: new Date().toISOString(),
      token,
      notes: [
        "Full safety: honeypot+tax (honeypot.is), mint/blacklist/pause + ownership (onchain), " +
          "holder concentration, LP burn/lock (v2 + v3). See token.checks[] + token.safetyConfidence.",
        "Score is a risk filter, not a guarantee. Not financial advice.",
      ],
    },
    { headers: { "cache-control": "public, max-age=30" } },
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
        price: X402_PRICE,
      },
      description:
        "Score one specific Base token (safety + momentum → AVOID/WATCH/HOT) with per-signal " +
        "checks and confidence. The 'is this token safe?' check, in one x402 call.",
      serviceName: "RugSense — Token Check",
    },
    x402Server,
  );
}

export const GET = buildGet();
