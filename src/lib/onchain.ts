import { parseAbiItem, type Address, getAddress } from "viem";
import { publicClient as client } from "./client";

// Primary launch-discovery source: read recent pool/pair creation events straight
// from Base DEX factories. This is the real "new launch" signal (DexScreener's
// token-profiles feed is global + sparse, so it can't be the source of truth).
// Each newly created pool reveals a token; the side that isn't a known quote
// asset (WETH/USDC/...) is the "launch". Enrichment + scoring happen downstream.

// Known quote/base assets on Base — the *other* token in a new pool is the launch.
const QUOTE_TOKENS = new Set(
  [
    "0x4200000000000000000000000000000000000006", // WETH
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC
    "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", // USDbC
    "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", // DAI
    "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", // cbBTC
    "0x940181a94A35A4569E4529A3CDfB74e38FD98631", // AERO
  ].map((a) => a.toLowerCase()),
);

const FACTORIES = [
  {
    name: "uniswap-v3",
    address: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD" as Address,
    event: parseAbiItem(
      "event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)",
    ),
  },
  {
    name: "uniswap-v2",
    address: "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6" as Address,
    event: parseAbiItem(
      "event PairCreated(address indexed token0, address indexed token1, address pair, uint256)",
    ),
  },
  {
    name: "aerodrome",
    address: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da" as Address,
    event: parseAbiItem(
      "event PoolCreated(address indexed token0, address indexed token1, bool indexed stable, address pool, uint256)",
    ),
  },
] as const;

export interface DiscoveredToken {
  address: Address;
  blockNumber: bigint;
}

/** The launch token = whichever side of the new pool isn't a known quote asset. */
function pickLaunchToken(token0?: Address, token1?: Address): Address | null {
  const a = token0 ? token0.toLowerCase() : "";
  const b = token1 ? token1.toLowerCase() : "";
  const aQuote = QUOTE_TOKENS.has(a);
  const bQuote = QUOTE_TOKENS.has(b);
  if (aQuote && !bQuote && token1) return token1;
  if (bQuote && !aQuote && token0) return token0;
  // Both or neither are quotes — pick token0 as best-effort.
  return token0 ?? token1 ?? null;
}

/**
 * Discover tokens from pools created in the last `blocksBack` blocks.
 * Base ~2s blocks → 1800 blocks ≈ last hour. Newest first, deduped.
 */
export async function discoverRecentLaunchTokens(
  blocksBack = 1800,
): Promise<DiscoveredToken[]> {
  let latest: bigint;
  try {
    latest = await client.getBlockNumber();
  } catch {
    return [];
  }
  const fromBlock = latest - BigInt(blocksBack);

  const perFactory = await Promise.all(
    FACTORIES.map(async (f) => {
      try {
        const logs = await client.getLogs({
          address: f.address,
          event: f.event,
          fromBlock,
          toBlock: latest,
        });
        return logs.map((log) => {
          const args = log.args as { token0?: Address; token1?: Address };
          const token = pickLaunchToken(args.token0, args.token1);
          return token ? { address: token, blockNumber: log.blockNumber ?? 0n } : null;
        });
      } catch {
        return [];
      }
    }),
  );

  const seen = new Map<string, DiscoveredToken>();
  for (const t of perFactory.flat()) {
    if (!t) continue;
    const key = t.address.toLowerCase();
    const prev = seen.get(key);
    if (!prev || t.blockNumber > prev.blockNumber) {
      seen.set(key, { address: getAddress(t.address), blockNumber: t.blockNumber });
    }
  }

  return [...seen.values()].sort((a, b) => Number(b.blockNumber - a.blockNumber));
}
