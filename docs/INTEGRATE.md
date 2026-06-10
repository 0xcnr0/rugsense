# Integrate — RugSense

Scored intelligence on freshly-launched Base tokens, one **x402** call. No API keys, no
signup — the caller's wallet pays **$0.03 USDC** on Base per call.

- **Endpoints:**
  - `GET /api/launches/latest` — latest scored launches, ranked (Bazaar-discoverable). $0.03.
  - `GET /api/token/{address}` — deep-score one token ("is this token safe?"). $0.03.
  - `GET /api/tokens/batch?addresses=…` — batch-score up to 20 tokens (pre-screen a watchlist). $0.10.
- **Protocol:** x402 v2 (network `eip155:8453`, USDC). Base URL `https://rugsense.xyz`.
- **Machine-readable spec:** [`/openapi.json`](https://rugsense.xyz/openapi.json).

## Query params
| param | meaning |
|---|---|
| `limit` | max launches, 1–50 (default 20) |
| `tier` | filter: `HOT` \| `WATCH` \| `AVOID` |
| `minSafety` | only launches with `safetyScore` ≥ this (0–100) |

## Response (per launch)
```jsonc
{
  "address": "0x…", "symbol": "TKN", "tier": "WATCH",
  "composite": 63,            // 0-100, safety-gated — the number to gate on
  "safetyScore": 70, "momentumScore": 55,
  "safetyConfidence": 75,     // how complete the safety assessment is
  "safetyPartial": false,     // true → key checks couldn't run, treat with caution
  "checks": [ { "key": "honeypot", "status": "pass" }, … ],  // per-signal audit
  "safety": { "honeypot": false, "sellTax": 0, "verified": true, "proxy": false,
              "top10Pct": 12, "lpSecuredPct": 100, … },
  "flags": [ { "code": "SELLABLE", "severity": "info" } ]
}
```
**Signals** (deterministic, no LLM): honeypot + buy/sell tax (trade sim), source-verified,
proxy, mint/blacklist/pause + ownership, owner-mutable trade-control latent-honeypot, holder
concentration, sniper/bundle supply, funding-source wallet clusters, transaction-graph
centrality, serial-deployer reputation + prior-token outcomes, a repeat-offender wallet
denylist (built from rugs we've caught), and LP burn/lock + duration (v2 + v3).

## Score one specific token
```
GET /api/token/{address}    e.g. /api/token/0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed
```
Returns `{ token: ScoredLaunch, notes }` with the **deep** assessment (incl. Etherscan deployer
reputation / serial-rugger history + funding cluster) for that address. Settles only on success —
an invalid address (`400`) or a token with no Base pool (`404`) is **not** charged.

## Batch-score a watchlist
```
GET /api/tokens/batch?addresses=0xabc…,0xdef…,0x123…    (1–20, comma-separated)
```
Returns `{ count, requested, results: [{ address, scored, error? }] }`. Feed-grade scoring
per token — pre-screen a candidate set in one $0.10 call, then deep-verify survivors with
`/api/token/{address}`. Charged only if at least one address resolves to a Base pool.

## 1. Unpaid request → see the price (any HTTP client)
```bash
curl -i https://rugsense.xyz/api/launches/latest
# 402 Payment Required, with a PAYMENT-REQUIRED header (x402 v2 challenge)
```

## 2. Pay automatically (TypeScript, x402 v2 client)
```ts
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount(process.env.BUYER_PRIVATE_KEY as `0x${string}`);
const client = new x402Client();
registerExactEvmScheme(client, { signer: account as never });
const fetchWithPay = wrapFetchWithPayment(fetch, client);

const res = await fetchWithPay(
  "https://rugsense.xyz/api/launches/latest?tier=HOT&minSafety=60",
);
console.log(await res.json());
```
The wallet needs USDC on Base. The `exact` scheme uses EIP-3009 (gasless for the payer).
A runnable version is in [`scripts/buyer-test.ts`](../scripts/buyer-test.ts).

## 3. As an MCP tool (Claude Desktop, Cursor, any MCP agent)
The repo ships an MCP server exposing three tools — `get_base_launches`,
`check_base_token`, `check_base_tokens_batch` — that handle x402 payment with the
agent's wallet. Drop this into your MCP client config (one block):
```jsonc
{
  "mcpServers": {
    "rugsense": {
      "command": "npx",
      "args": ["-y", "tsx", "/abs/path/to/mcp/server.ts"],
      "env": { "BUYER_PRIVATE_KEY": "0x<a Base wallet funded with USDC>" }
    }
  }
}
```
See [`mcp/README.md`](../mcp/README.md).

## 4. In an agent framework (one-liner via MCP)
**Coinbase AgentKit** — expose RugSense tools to your agent:
```ts
import { getMcpTools } from "@coinbase/agentkit";
const { tools } = await getMcpTools({ /* rugsense MCP server config above */ });
// pass `tools` to your AgentKit agent — it can now gate trades on RugSense scores
```
**LangChain / LangGraph** — `langchain-mcp-adapters`, ~5 lines:
```python
from langchain_mcp_adapters.tools import load_mcp_tools
from langgraph.prebuilt import create_react_agent
# session = an MCP ClientSession connected to the rugsense server
tools = await load_mcp_tools(session)
agent = create_react_agent(model, tools)
# the agent now has get_base_launches / check_base_token / check_base_tokens_batch
```

## Gating pattern (how an agent should use this)
```ts
const r = await fetchWithPay(`https://rugsense.xyz/api/token/${token}`);
const { token: t } = await r.json();
if (t.tier === "AVOID" || t.composite < 60 || t.safetyConfidence < 50) return skip();
proceedToSwap();  // only HOT/WATCH with enough confidence
```

## Notes
- Scores are a **risk filter, not a guarantee** — gate on `composite` + `safetyConfidence`,
  and treat `safetyPartial: true` cautiously.
- Latency: discovery + onchain checks fan out per call; expect ~a few seconds.
