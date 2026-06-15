/**
 * Register RugSense in the ERC-8004 Identity Registry on Base (Level 2 of docs/ERC-8004.md).
 *
 * This mints an agent NFT pointing at our agent-card (agentURI) so RugSense becomes
 * discoverable by every ERC-8004 client (8004scan, RNWY, Agent0 subgraph, etc.).
 * Cost: one tx, gas "well under a cent" on Base. SAFE BY DEFAULT — it does nothing
 * without a key, so you can run it to see the plan first.
 *
 * Run:
 *   REGISTER_PRIVATE_KEY=0x<hot wallet w/ a little ETH on Base> \
 *   BASE_RPC_URL=https://base.publicnode.com \
 *   npx tsx scripts/register-8004.ts
 *
 * Use a LOW-VALUE hot wallet, not your x402 receiving wallet. After it prints your
 * agentId, paste the printed `registrations` entry into
 * public/.well-known/agent-card.json and redeploy.
 */
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const IDENTITY_REGISTRY = (process.env.IDENTITY_REGISTRY ||
  "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432") as `0x${string}`;
const AGENT_URI = process.env.AGENT_URI || "https://rugsense.xyz/.well-known/agent-card.json";
const RPC = process.env.BASE_RPC_URL || "https://base.publicnode.com";
const PK = process.env.REGISTER_PRIVATE_KEY;

// ERC-8004 Identity Registry: register(string agentURI) returns (uint256 agentId)
const ABI = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
]);

async function main() {
  console.log("ERC-8004 registration (Base)");
  console.log("  Identity Registry:", IDENTITY_REGISTRY);
  console.log("  agentURI:         ", AGENT_URI);
  console.log("  RPC:              ", RPC);

  if (!PK || !/^0x[0-9a-fA-F]{64}$/.test(PK.trim())) {
    console.log("\nDRY RUN — no valid REGISTER_PRIVATE_KEY set. Nothing was sent.");
    console.log("To register, re-run with a funded Base hot wallet:");
    console.log("  REGISTER_PRIVATE_KEY=0x... npx tsx scripts/register-8004.ts");
    return;
  }

  const account = privateKeyToAccount(PK.trim() as `0x${string}`);
  const publicClient = createPublicClient({ chain: base, transport: http(RPC) });
  const walletClient = createWalletClient({ account, chain: base, transport: http(RPC) });

  console.log("\n  from:", account.address);
  const bal = await publicClient.getBalance({ address: account.address });
  console.log("  balance:", Number(bal) / 1e18, "ETH");
  if (bal === 0n) {
    console.log("\nWallet has 0 ETH on Base — fund it with a little ETH for gas, then re-run.");
    return;
  }

  // Simulate to get the returned agentId, then send.
  const { result: agentId, request } = await publicClient.simulateContract({
    account,
    address: IDENTITY_REGISTRY,
    abi: ABI,
    functionName: "register",
    args: [AGENT_URI],
  });

  const hash = await walletClient.writeContract(request);
  console.log("\n  tx sent:", hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("  mined in block", receipt.blockNumber, "· status:", receipt.status);
  console.log("\n✅ Registered. agentId =", agentId.toString());
  console.log("\nPaste this into public/.well-known/agent-card.json → registrations[] and redeploy:");
  console.log(
    JSON.stringify(
      [{ agentId: agentId.toString(), agentAddress: `eip155:8453:${account.address}`, agentDomain: "rugsense.xyz" }],
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error("Registration failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
