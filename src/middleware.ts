import { NextResponse, type NextRequest } from "next/server";
import { paymentProxy } from "@x402/next";
import { declareDiscoveryExtension } from "@x402/extensions";
import { x402Server, X402_ENABLED, X402_PAY_TO, X402_PRICE, X402_NETWORK_CAIP2 } from "@/lib/x402";

// x402 v2 payment gate as Next.js middleware. Unlike route-level withX402 (which
// registers a "*" pattern → bogus ":var1" Bazaar routeTemplate), paymentProxy uses the
// explicit path key, so the declared routeTemplate matches the resource URL.
// Runs on the Node runtime (our facilitator/crypto libs need it).

const DISCOVERY = declareDiscoveryExtension({
  input: {},
  inputSchema: {
    properties: {
      limit: { type: "string", description: "Max launches (1-50, default 20)" },
      tier: { type: "string", description: "Filter by tier: HOT | WATCH | AVOID" },
      minSafety: { type: "string", description: "Only launches with safetyScore >= this (0-100)" },
    },
  },
  output: {
    example: {
      chain: "base",
      count: 1,
      launches: [
        {
          address: "0x…",
          symbol: "TKN",
          tier: "WATCH",
          composite: 63,
          safetyScore: 70,
          momentumScore: 55,
          safetyConfidence: 75,
          flags: [{ code: "SELLABLE", severity: "info" }],
        },
      ],
    },
  },
});

// Static route → the server won't auto-derive a routeTemplate, and (unlike the "*"
// case) it won't override an explicit one. Set it to match the resource URL path.
for (const key of Object.keys(DISCOVERY)) {
  (DISCOVERY[key] as { routeTemplate?: string }).routeTemplate = "/api/launches/latest";
}

const gate =
  X402_ENABLED && X402_PAY_TO
    ? paymentProxy(
        {
          "/api/launches/latest": {
            accepts: {
              scheme: "exact",
              network: X402_NETWORK_CAIP2 as `eip155:${string}`,
              payTo: X402_PAY_TO,
              price: X402_PRICE,
            },
            description:
              "Scored intelligence on freshly-launched Base tokens: safety + momentum → composite " +
              "score and an AVOID/WATCH/HOT decision per launch. One call returns a ranked list.",
            serviceName: "RugSense",
            extensions: DISCOVERY,
          },
        },
        x402Server,
      )
    : null;

export function middleware(req: NextRequest): Promise<NextResponse> | NextResponse {
  if (gate) return gate(req);
  return NextResponse.next();
}

export const config = {
  matcher: "/api/launches/latest",
  runtime: "nodejs",
};
