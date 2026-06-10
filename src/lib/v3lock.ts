import { parseAbiItem, getAddress, type Address, type Abi } from "viem";
import { publicClient } from "./client";

// Uniswap-v3 LP-lock detection. v3 liquidity is an NFT position in the
// NonfungiblePositionManager (NFPM); the rug vector is the position OWNER calling
// decreaseLiquidity. So we resolve the launch pool's position-NFT owner and classify:
//   burned / known-locker        → provably secured
//   other contract               → "locked-unverified" (likely a locker, but we can't
//                                   prove it has no withdraw → no safety credit, no gaming)
//   EOA                          → PULLABLE (the real rug signal — now caught, was "unknown")

const NFPM = "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1"; // Base Uniswap v3 position manager
const DEAD = "0x000000000000000000000000000000000000dead";
const ZERO = "0x0000000000000000000000000000000000000000";
const ERC721_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// Verified no-withdraw v3 lockers — an entry here grants full safety credit, so add ONLY
// addresses confirmed to lack a liquidity-withdraw path.
// Clanker LP Lockers (per clanker.gitbook.io deployed-contracts): the position NFT is sent
// here and "does not have a method to withdraw the position NFT and is not upgradeable" —
// liquidity is locked forever. (Verified on-chain as contracts.) Extend with UNCX v3 etc.
const KNOWN_V3_LOCKERS: ReadonlySet<string> = new Set<string>(
  [
    "0x63D2DfEA64b3433F4071A98665bcD7Ca14d93496", // Clanker LpLocker v4
    "0x33e2Eda238edcF470309b8c6D228986A1204c8f9", // Clanker LpLocker v3.1
    "0x5eC4f99F342038c67a312a166Ff56e6D70383D86", // Clanker LpLocker v3.0
    "0x618A9840691334eE8d24445a4AdA4284Bf42417D", // Clanker LpLocker v2.0
  ].map((a) => a.toLowerCase()),
);

const POOL_MINT = parseAbiItem(
  "event Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)",
);
const OWNEROF_ABI = [
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
] as const satisfies Abi;

export type V3LockStatus = "burned" | "locked_verified" | "locked_unverified" | "pullable" | "unknown";

export interface V3LpLock {
  status: V3LockStatus;
  owner: string | null;
}

/** Resolve the launch pool's v3 position-NFT owner and classify lock status. */
export async function getV3LpLock(
  pool: Address,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<V3LpLock> {
  try {
    const mints = await publicClient.getLogs({ address: pool, event: POOL_MINT, fromBlock, toBlock });
    if (mints.length === 0 || !mints[0].transactionHash) return { status: "unknown", owner: null };

    // The position NFT is minted (Transfer from 0x0) by the NFPM in the same tx.
    const rcpt = await publicClient.getTransactionReceipt({ hash: mints[0].transactionHash });
    const mintLog = rcpt.logs.find(
      (l) =>
        l.address.toLowerCase() === NFPM.toLowerCase() &&
        l.topics[0] === ERC721_TRANSFER_TOPIC &&
        l.topics.length === 4 &&
        BigInt(l.topics[1] as `0x${string}`) === 0n, // from == 0x0 (mint)
    );
    if (!mintLog || !mintLog.topics[3]) return { status: "unknown", owner: null };

    const tokenId = BigInt(mintLog.topics[3]);
    const owner = (await publicClient.readContract({
      address: NFPM as Address,
      abi: OWNEROF_ABI,
      functionName: "ownerOf",
      args: [tokenId],
    })) as string;
    const o = owner.toLowerCase();

    if (o === ZERO || o === DEAD) return { status: "burned", owner };
    if (KNOWN_V3_LOCKERS.has(o)) return { status: "locked_verified", owner };

    const code = await publicClient.getCode({ address: getAddress(owner) });
    if (code && code.length > 2) return { status: "locked_unverified", owner };
    return { status: "pullable", owner };
  } catch {
    return { status: "unknown", owner: null };
  }
}
