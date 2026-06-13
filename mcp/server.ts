#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

// MCP server for RugSense. Drop it into any MCP client (Claude Desktop,
// Cursor, an agent framework) to give an agent a `get_base_launches` tool. Each call
// pays $0.03 USDC via x402 using the wallet in BUYER_PRIVATE_KEY (funded on Base).
//
//   Claude Desktop config example:
//   {
//     "mcpServers": {
//       "base-launch-radar": {
//         "command": "npx",
//         "args": ["-y", "tsx", "/abs/path/to/mcp/server.ts"],
//         "env": { "BUYER_PRIVATE_KEY": "0x..." }
//       }
//     }
//   }

const BASE_URL = (process.env.RADAR_URL || "https://rugsense.xyz/api/launches/latest")
  .replace(/\/api\/launches\/latest.*$/, "");
const FEED_URL = `${BASE_URL}/api/launches/latest`;
const TOKEN_URL = (addr: string) => `${BASE_URL}/api/token/${addr}`;
const BATCH_URL = `${BASE_URL}/api/tokens/batch`;
const QUICK_URL = (addr: string) => `${BASE_URL}/api/quick/${addr}`;
const WATCH_URL = (addr: string) => `${BASE_URL}/api/watch/${addr}`;
const DEPLOYER_URL = (addr: string) => `${BASE_URL}/api/deployer/${addr}`;
const TRACK_URL = `${BASE_URL}/api/track-record`;
const PK = process.env.BUYER_PRIVATE_KEY;

/** A fetch that auto-pays x402 when a buyer wallet is configured, else plain fetch. */
function makePayingFetch(): typeof globalThis.fetch {
  if (!PK) return fetch;
  const hex = PK.trim().replace(/^['"]|['"]$/g, "").replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return fetch;
  const account = privateKeyToAccount(`0x${hex.toLowerCase()}` as `0x${string}`);
  const client = new x402Client();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerExactEvmScheme(client, { signer: account as any });
  return wrapFetchWithPayment(fetch, client);
}

const payingFetch = makePayingFetch();

const server = new McpServer({ name: "rugsense", version: "1.1.0" });

const SIGNALS =
  "honeypot + buy/sell tax (trade simulation), mintable/blacklist/pausable + ownership, " +
  "owner-mutable trade-control latent-honeypot, holder concentration, sniper/bundle supply, " +
  "funding-source wallet clusters, transaction-graph centrality, serial-deployer reputation, " +
  "repeat-offender wallet denylist, and LP burn/lock + duration (Uniswap v2 + v3)";

server.registerTool(
  "get_base_launches",
  {
    title: "Get scored Base token launches (rug/honeypot risk feed)",
    description:
      "Ranked feed of freshly-launched Base tokens, each scored for safety + momentum into one " +
      "machine-actionable AVOID / WATCH / HOT decision with a 0-100 composite, a calibrated " +
      "safetyConfidence, and transparent per-signal checks[] (" + SIGNALS + "). Deterministic, " +
      "no LLM. Use it to discover or pre-screen new launches and skip rugs/honeypots. Pays $0.03 " +
      "USDC per call via x402 (needs BUYER_PRIVATE_KEY funded on Base).",
    inputSchema: {
      limit: z.number().int().min(1).max(50).optional().describe("Max launches (default 20)"),
      tier: z.enum(["HOT", "WATCH", "AVOID"]).optional().describe("Filter by decision tier"),
      minSafety: z.number().int().min(0).max(100).optional().describe("Min safetyScore (0-100) — gate on this"),
    },
  },
  async ({ limit, tier, minSafety }) => {
    const url = new URL(FEED_URL);
    if (limit) url.searchParams.set("limit", String(limit));
    if (tier) url.searchParams.set("tier", tier);
    if (minSafety) url.searchParams.set("minSafety", String(minSafety));
    return call(url.toString());
  },
);

server.registerTool(
  "check_base_token",
  {
    title: "Check if a specific Base token is safe (pre-trade rug gate)",
    description:
      "Deep-score ONE Base token by address — the 'is this token safe to buy?' gate an agent runs " +
      "before a swap. Returns the AVOID / WATCH / HOT decision + composite + calibrated confidence " +
      "and the full per-signal checks[] (" + SIGNALS + "), including the Etherscan-deep deployer " +
      "reputation / serial-rugger history and funding-cluster analysis. Pays $0.03 USDC via x402 " +
      "(needs BUYER_PRIVATE_KEY). Invalid address / no-pool is not charged.",
    inputSchema: {
      address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).describe("Base token contract address (0x + 40 hex)"),
    },
  },
  async ({ address }) => call(TOKEN_URL(address)),
);

server.registerTool(
  "check_base_tokens_batch",
  {
    title: "Batch-score many Base tokens at once",
    description:
      "Pre-screen a WATCHLIST: score up to 20 Base tokens in one call, each with its AVOID / WATCH / " +
      "HOT decision + composite + per-signal checks[]. Cheaper per-token than individual checks — " +
      "use it to filter a candidate set, then deep-verify survivors with check_base_token. Pays " +
      "$0.10 USDC via x402 (needs BUYER_PRIVATE_KEY). Charged only if at least one address resolves.",
    inputSchema: {
      addresses: z
        .array(z.string().regex(/^0x[a-fA-F0-9]{40}$/))
        .min(1)
        .max(20)
        .describe("Base token contract addresses (1-20)"),
    },
  },
  async ({ addresses }) => {
    const url = new URL(BATCH_URL);
    url.searchParams.set("addresses", addresses.join(","));
    return call(url.toString());
  },
);

server.registerTool(
  "quick_check_base_token",
  {
    title: "Fast, cheap pre-screen of one Base token",
    description:
      "The high-frequency triage gate: a DexScreener-grade AVOID / WATCH / HOT score for one Base " +
      "token, no onchain deep-dive — cheap and fast. Use it to filter many candidates, then " +
      "deep-verify survivors with check_base_token. Pays $0.005 USDC via x402 (needs " +
      "BUYER_PRIVATE_KEY). Invalid address / no-pool is not charged.",
    inputSchema: {
      address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).describe("Base token contract address (0x + 40 hex)"),
    },
  },
  async ({ address }) => call(QUICK_URL(address)),
);

server.registerTool(
  "watch_base_token",
  {
    title: "Register a token for lifecycle webhook alerts (push, not pull)",
    description:
      "Register a Base token + your callback URL; for 7 days we re-score it and POST your callback " +
      "the moment the verdict changes or a rug is in progress (liquidity collapse / pool removed). " +
      "The continuous monitoring a single scored read can't give you — use it after you take a " +
      "position to get an exit signal. Pays $0.05 USDC via x402 (needs BUYER_PRIVATE_KEY).",
    inputSchema: {
      address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).describe("Base token contract address (0x + 40 hex)"),
      callback: z.string().url().describe("HTTPS URL to receive webhook POSTs on tier change / rug-in-progress"),
    },
  },
  async ({ address, callback }) => {
    const url = new URL(WATCH_URL(address));
    url.searchParams.set("callback", callback);
    return call(url.toString());
  },
);

server.registerTool(
  "get_base_deployer_dossier",
  {
    title: "Accumulated dossier for a Base deployer wallet",
    description:
      "RugSense's proprietary, compounding record for a deployer wallet: every token we've seen it " +
      "ship, prior-rug outcomes, first-seen date, and whether it's on the repeat-offender denylist " +
      "we built from confirmed rugs. Pass a deployer EOA or a token address (we resolve its " +
      "deployer). Data that can't be re-derived from a single free-API call. Pays $0.02 USDC via " +
      "x402 (needs BUYER_PRIVATE_KEY). Unknown deployer returns found:false (still a useful answer).",
    inputSchema: {
      address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).describe("Deployer EOA or token contract address (0x + 40 hex)"),
    },
  },
  async ({ address }) => call(DEPLOYER_URL(address)),
);

server.registerTool(
  "get_rugsense_track_record",
  {
    title: "RugSense's verifiable, point-in-time hit rate (free)",
    description:
      "The leakage-free scoreboard of every RugSense verdict: avoid.precisionPct = share of resolved " +
      "AVOIDs that rugged; safe.cleanPct = share of resolved HOT/WATCH that did NOT rug. Every token " +
      "was snapshotted at score time and graded strictly later, so the numbers can't be inflated by " +
      "post-collapse data. Free (no payment). Call this to decide whether RugSense's signal is worth " +
      "paying for before you wire up the paid tools.",
    inputSchema: {},
  },
  async () => call(TRACK_URL),
);

/** Shared: pay-and-fetch a Radar URL, returning an MCP tool result. */
async function call(url: string) {
  try {
    const res = await payingFetch(url);
    const text = await res.text();
    if (res.status !== 200) {
      const hint = PK ? "" : " — set BUYER_PRIVATE_KEY (a Base wallet with USDC) to pay.";
      return {
        content: [{ type: "text" as const, text: `Request failed (HTTP ${res.status})${hint}\n${text.slice(0, 400)}` }],
        isError: true,
      };
    }
    return { content: [{ type: "text" as const, text }] };
  } catch (e) {
    return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
  }
}

// Wrapped in an IIFE (not top-level await) so it runs under tsx's CJS transform.
void (async () => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
})();
