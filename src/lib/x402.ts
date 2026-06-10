import { x402ResourceServer } from "@x402/next";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { bazaarResourceServerExtension } from "@x402/extensions";
import { facilitator as cdpFacilitator } from "@coinbase/x402";

// x402 v2 resource server (shared, built once). v2 uses an x402ResourceServer with a
// facilitator client + a registered scheme, and a Bazaar extension for discovery.
//   - CDP keys present → Coinbase CDP facilitator (mainnet + Bazaar cataloging)
//   - otherwise → default x402.org facilitator (base-sepolia testing)

const useCdp = !!process.env.CDP_API_KEY_ID && !!process.env.CDP_API_KEY_SECRET;

const facilitatorClient = useCdp
  ? new HTTPFacilitatorClient(cdpFacilitator)
  : new HTTPFacilitatorClient(); // defaults to https://x402.org/facilitator (testnet)

export const x402Server = new x402ResourceServer(facilitatorClient);
registerExactEvmScheme(x402Server);
x402Server.registerExtension(bazaarResourceServerExtension); // enable Bazaar discovery

// CAIP-2 network id from our env: "base" → eip155:8453, "base-sepolia" → eip155:84532.
export const X402_NETWORK_CAIP2 =
  process.env.X402_NETWORK === "base" ? "eip155:8453" : "eip155:84532";

export const X402_ENABLED = process.env.X402_ENABLED === "true";
export const X402_PAY_TO = process.env.X402_PAY_TO as `0x${string}` | undefined;
export const X402_PRICE = `$${process.env.X402_PRICE || "0.03"}`;
// Batch endpoint: one flat price for up to N tokens (cheaper per-token than singles,
// to reward pre-screening a watchlist in one call).
export const X402_BATCH_PRICE = `$${process.env.X402_BATCH_PRICE || "0.10"}`;
