import { NextResponse, type NextRequest } from "next/server";
import { isAddress } from "viem";
import { withX402 } from "@x402/next";
import { getPairsForToken, primaryPair } from "@/lib/dexscreener";
import { scoreLaunch } from "@/lib/scoring";
import { trackCall } from "@/lib/analytics";
import { x402Server, X402_ENABLED, X402_PAY_TO, X402_QUICK_PRICE, X402_NETWORK_CAIP2 } from "@/lib/x402";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/quick/{address}   ($0.005)
// The cheap, fast pre-screen: a DexScreener-only feed-grade AVOID/WATCH/HOT score for
// one token — no onchain/Etherscan deep-dive. Built for high-frequency gating where an
// agent triages many candidates and only deep-verifies survivors via /api/token.
//
// Same settle-on-success semantics as /api/token: invalid address (400) / no pool (404)
// are not charged.
async function handler(req: NextRequest): Promise<NextResponse> {
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

  const token = scoreLaunch(pair);
  trackCall("quick", [token.tier]);
  return NextResponse.json(
    {
      chain: "base",
      generatedAt: new Date().toISOString(),
      token,
      notes: [
        "Quick mode: DexScreener-grade score (liquidity/age/momentum + fast safety heuristics). " +
          "safetyConfidence is partial — for the full honeypot sim + onchain holder/LP + Etherscan " +
          "deployer/cluster verify, call /api/token/{address}.",
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
        price: X402_QUICK_PRICE,
      },
      description:
        "Fast, cheap AVOID/WATCH/HOT pre-screen for one Base token (DexScreener-grade, no onchain " +
        "deep-dive). The high-frequency triage gate; deep-verify survivors with /api/token.",
      serviceName: "RugSense — Quick Check",
    },
    x402Server,
  );
}

export const GET = buildGet();
