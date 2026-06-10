import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

// Shared read-only Base client. Defaults to the public RPC (free); set BASE_RPC_URL
// to a dedicated provider (e.g. Alchemy/QuickNode free tier) for reliable holder/LP
// log reconstruction under load.
export const RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";

export const publicClient = createPublicClient({
  chain: base,
  // Retry transient failures (rate-limits) instead of degrading straight to "unknown".
  // NOTE: no JSON-RPC request batching (batch:true) — some providers (e.g. Alchemy)
  // reject batched eth_getLogs ("JSON is not a valid request object"), which silently
  // broke discovery. We still coalesce contract reads via multicall below.
  transport: http(RPC_URL, { retryCount: 3, retryDelay: 250, timeout: 12_000 }),
  batch: { multicall: true },
});
