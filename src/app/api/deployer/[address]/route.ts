import { NextResponse, type NextRequest } from "next/server";
import { isAddress, type Address } from "viem";
import { withX402 } from "@x402/next";
import { resolveDeployerAddress } from "@/lib/deployer";
import { getDeployerDossier } from "@/lib/deployerstore";
import { trackCall } from "@/lib/analytics";
import { x402Server, X402_ENABLED, X402_PAY_TO, X402_DEPLOYER_PRICE, X402_NETWORK_CAIP2 } from "@/lib/x402";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/deployer/{address}   ($0.02)
// The accumulated dossier for a deployer wallet — our proprietary, compounding record
// of every token we've seen it ship, prior-rug outcomes, first-seen date, and whether
// it's on the repeat-offender denylist we built from confirmed rugs. Pass a deployer
// EOA, or a token address (we resolve its deployer). This is data that grows with our
// operation; it can't be re-derived from a single free-API call.
//
// Settles only on success: an invalid address is not charged. An unknown deployer
// returns 200 with found:false (it's a valid, useful answer — "no history on file").
async function handler(req: NextRequest): Promise<NextResponse> {
  const queried = req.nextUrl.pathname.split("/").filter(Boolean).pop() ?? "";

  if (!isAddress(queried)) {
    return NextResponse.json(
      { error: "invalid_address", message: "Provide a valid address (deployer EOA or token, 0x + 40 hex)." },
      { status: 400 },
    );
  }

  // Resolve: if we have no dossier under the queried address, try treating it as a
  // token and resolving its deployer. Either way we report what we looked up.
  let deployer = queried.toLowerCase();
  let dossier = await getDeployerDossier(deployer, queried);
  if (!dossier.found) {
    try {
      const resolved = await resolveDeployerAddress(queried as Address);
      if (resolved && resolved.toLowerCase() !== deployer) {
        deployer = resolved.toLowerCase();
        dossier = await getDeployerDossier(deployer, queried);
      }
    } catch {
      /* resolution is best-effort; fall through with the empty dossier */
    }
  }

  trackCall("deployer", [dossier.riskLevel]);
  return NextResponse.json(
    {
      chain: "base",
      generatedAt: new Date().toISOString(),
      dossier,
      notes: [
        "Accumulated from every launch RugSense has scored — tokensSeen / prior-rug outcomes / " +
          "first-seen grow over time. onDenylist=true means this wallet deployed a rug we confirmed.",
        "found:false simply means no history on file yet. A risk filter, not a guarantee. Not financial advice.",
      ],
    },
    { headers: { "cache-control": "public, max-age=60" } },
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
        price: X402_DEPLOYER_PRICE,
      },
      description:
        "Accumulated deployer dossier: every token we've seen this wallet ship, prior-rug outcomes, " +
        "first-seen date, and repeat-offender denylist status. Pass a deployer EOA or a token address.",
      serviceName: "RugSense — Deployer Dossier",
    },
    x402Server,
  );
}

export const GET = buildGet();
