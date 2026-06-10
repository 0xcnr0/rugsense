import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

// Simulate an AI-agent buyer on x402 v2: build an x402Client with the EVM exact
// scheme + a signer, wrap fetch, call the gated endpoint → auto-pays USDC → gets data.
// Prereq: BUYER_PRIVATE_KEY = a wallet funded with USDC on the target network
// (Base mainnet for prod). The "exact" scheme uses EIP-3009 (gasless for the payer).
//
// Run: BUYER_PRIVATE_KEY=0x... RADAR_URL=https://.../api/launches/latest npx tsx scripts/buyer-test.ts
(async () => {
  const rawPk = process.env.BUYER_PRIVATE_KEY;
  const url = process.env.RADAR_URL || "http://localhost:3001/api/launches/latest?limit=3";
  if (!rawPk) {
    console.error("Set BUYER_PRIVATE_KEY (a wallet funded with USDC on the target network).");
    process.exit(1);
  }
  const hex = rawPk.trim().replace(/^['"]|['"]$/g, "").replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    console.error(`BUYER_PRIVATE_KEY malformed: expected 64 hex chars, got ${hex.length}.`);
    process.exit(1);
  }

  // The exact scheme's base flow needs a signer with `address` + `signTypedData`.
  // A viem LocalAccount has both directly (a WalletClient hides address under .account).
  const account = privateKeyToAccount(`0x${hex.toLowerCase()}` as `0x${string}`);

  const client = new x402Client();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerExactEvmScheme(client, { signer: account as any });
  const fetchWithPay = wrapFetchWithPayment(fetch, client);

  console.log(`Buyer ${account.address} calling ${url} …`);
  const res = await fetchWithPay(url);
  console.log("HTTP", res.status);
  const body = await res.json();
  console.log(JSON.stringify(body, null, 2).slice(0, 1200));
})();
