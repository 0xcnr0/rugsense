import { NextResponse, type NextRequest } from "next/server";
import { isAddress } from "viem";
import { withX402 } from "@x402/next";
import { getPairsForToken, primaryPair } from "@/lib/dexscreener";
import { scoreLaunchOnchain } from "@/lib/scoring";
import { trackCall } from "@/lib/analytics";
import { x402Server, X402_ENABLED, X402_PAY_TO, X402_BATCH_PRICE, X402_NETWORK_CAIP2 } from "@/lib/x402";
import type { ScoredLaunch } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/tokens/batch?addresses=0x..,0x..,0x..
// Score MANY Base tokens in one x402 call — pre-screen a watchlist / candidate set
// before an agent acts. Flat price for up to MAX_TOKENS (cheaper per-token than
// individual /api/token calls). Feed-grade scoring (the full onchain decision +
// holder/LP/sniper/centrality/reputation signals); the per-token endpoint adds the
// Etherscan-deep deployer/cluster verify for a single "is THIS one safe?" check.
//
// Settles only on success (<400). An all-invalid request (400) or a set where no
// address resolves to a Base pool (404) is NOT charged.
const MAX_TOKENS = 20;
const CONCURRENCY = 5;

interface BatchItem {
  address: string;
  scored: ScoredLaunch | null;
  error?: string;
}

async function handler(req: NextRequest): Promise<NextResponse> {
  const raw = req.nextUrl.searchParams.get("addresses") ?? "";
  const requested = raw.split(",").map((a) => a.trim()).filter(Boolean).slice(0, MAX_TOKENS);

  if (requested.length === 0) {
    return NextResponse.json(
      { error: "no_addresses", message: "Pass ?addresses=0x..,0x.. (comma-separated, up to 20)." },
      { status: 400 },
    );
  }
  if (requested.every((a) => !isAddress(a))) {
    return NextResponse.json(
      { error: "invalid_addresses", message: "No valid Base token address in the request." },
      { status: 400 },
    );
  }

  const now = Date.now();
  const items: BatchItem[] = new Array(requested.length);
  let resolved = 0;

  // Bounded concurrency so a 20-token batch stays inside the 60s budget.
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < requested.length) {
      const i = cursor++;
      const address = requested[i];
      if (!isAddress(address)) {
        items[i] = { address, scored: null, error: "invalid_address" };
        continue;
      }
      try {
        const pair = primaryPair(await getPairsForToken(address));
        if (!pair) {
          items[i] = { address, scored: null, error: "no_pool" };
          continue;
        }
        // Feed-grade (no Etherscan-deep) to keep the batch fast; still the full
        // composite decision + onchain safety + holder-reputation.
        items[i] = { address, scored: await scoreLaunchOnchain(pair, now, false) };
        resolved++;
      } catch {
        items[i] = { address, scored: null, error: "score_error" };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, requested.length) }, worker));

  if (resolved === 0) {
    return NextResponse.json(
      { error: "not_found", message: "None of the addresses resolved to a Base DEX pool.", count: 0 },
      { status: 404 },
    );
  }

  trackCall("token", items.filter((i) => i.scored).map((i) => i.scored!.tier));
  return NextResponse.json(
    {
      chain: "base",
      generatedAt: new Date(now).toISOString(),
      count: resolved,
      requested: requested.length,
      results: items,
      notes: [
        "Batch = feed-grade composite decision per token. For the Etherscan-deep " +
          "deployer/cluster verify on a single token, use GET /api/token/{address}.",
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
        price: X402_BATCH_PRICE,
      },
      description:
        "Batch-score up to 20 Base tokens (safety + momentum → AVOID/WATCH/HOT each) in one " +
        "x402 call — pre-screen a watchlist before acting. Per-signal checks + confidence per token.",
      serviceName: "RugSense — Batch Token Check",
    },
    x402Server,
  );
}

export const GET = buildGet();
