# RugSense

Agent-native **scored launch intelligence** for Base — sold per-call over **x402** (USDC).

Not another raw "new pairs" feed (DexScreener already owns that, free). The wedge:
a single **x402-payable** call that returns, per fresh Base launch, a composite
**opportunity/risk score + structured flags + an `AVOID / WATCH / HOT` decision**
that a trading/research agent can act on directly — the gap between DexScreener
(raw, human-first) and GoPlus (security-only).

## How it works

```
onchain DEX factory events (viem)  ─┐
DexScreener enrich (liq/vol/age)    ├─►  scoring engine (deterministic, no LLM)  ──►  /api/launches/latest
honeypot.is (honeypot/tax/verified/proxy)  safety + momentum → composite → AVOID/WATCH/HOT   (x402 v2, USDC on Base)
holder concentration + LP burn/lock ─┘     + transparent checks[] + safetyConfidence
```

- **🟢 Live on Base mainnet, earning per-call.** Discoverable on x402 Bazaar / Agentic.Market.
- **Buyers:** AI agents (via x402 + the MCP server) and humans (the landing page).
- **Cost:** ~$0 — free hosting + free data APIs; no LLM; payer covers gas (EIP-3009).

## Run

```bash
npm install
npm run score:demo            # scoring sanity check (no network)
npm test                      # deterministic scoring test suite
npx tsx scripts/verify-live.ts # live: discovery → enrich → score (needs network)
npm run daily                 # generate a daily "today's HOT / filtered rugs" post
npm run dev                   # http://localhost:3000 + /api/launches/latest
BUYER_PRIVATE_KEY=0x… npm run mcp  # MCP server (get_base_launches tool)
```

## Use it
- **Endpoint:** `GET /api/launches/latest?limit=20&tier=HOT&minSafety=60` (x402 v2, $0.03 USDC/call).
- **Integration guide** (curl / x402 client / MCP): [`docs/INTEGRATE.md`](docs/INTEGRATE.md).
- **MCP server:** [`mcp/README.md`](mcp/README.md).

## Status

- [x] Onchain discovery + DexScreener enrichment + deterministic scoring (`src/lib/scoring.ts`).
- [x] Hardened safety (`src/lib/assess.ts`): honeypot+tax+verified+proxy (honeypot.is), mint/
      blacklist/pause+ownership (RPC), holder concentration + v2/v3 LP burn-lock. Transparent
      `checks[]` + `safetyConfidence`. Security-audited (`SECURITY.md`).
- [x] **x402 v2** (`@x402/next` + paymentProxy middleware + Bazaar `declareDiscoveryExtension`).
      Real mainnet paid round-trip verified.
- [x] **Live on mainnet** + indexed on x402 Bazaar / Agentic.Market.
- [x] MCP server (`mcp/`), human storefront, daily content generator, test suite.
- [ ] Custom domain (dedicated-domain quality signal); Farcaster mini-app (MiniKit) + auto-poster.
- [ ] Dedicated factory-event indexer (lower latency than the DexScreener bootstrap).

Orientation for a new session: [`CLAUDE.md`](CLAUDE.md). Plan/business: `docs/`.
