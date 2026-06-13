# Agent Demand Research & Differentiation Roadmap (June 2026)

> Deep-research synthesis (24 sources, 113 extracted claims, 20 verified — 16 by
> 3-vote adversarial panel, 4 re-verified directly against primary sources after a
> quota interruption). Question: **how does RugSense become genuinely *needed* by
> agents/agent devs, given the core analysis is replicable with free APIs?**

## 1. The honest problem statement (confirmed)

- **Payment UX is no longer a moat.** Multiple x402-native, no-API-key competitors
  exist: [QuantumShield](https://quantumshield-api.vercel.app/) ("Security
  Intelligence for the Agentic Web" — token risk, wallet reputation, honeypot
  detection, USDC micropayments on Base) and
  [fernsugi/x402-api-mcp-server](https://github.com/fernsugi/x402-api-mcp-server)
  (8 DeFi tools, `scan_token` rug detection at **0.003 USDC** — 10× cheaper than
  our $0.03).
- **GoPlus ships an official MCP server** ([goplus-mcp](https://github.com/GoPlusSecurity/goplus-mcp))
  with honeypot / liquidity / holder-concentration analysis across 35+ EVM chains
  + Solana/Tron/Sui, plus malicious-address, phishing, NFT and approval security.
  Any Claude/Cursor agent can call it today.
- **Agent demand for paid data is real but small.** Chainalysis: the Q4-2025 x402
  volume surge was "driven in large part by meme coin activity, particularly PING"
  (150k+ tx in its first month); Q1-2026 growth moderated. Positive signal: $1+
  transactions rose from 49% → 95% of volume and retention drifted up — a smaller
  but *realer* cohort. Coinbase shipped an AI agent that "trades and pays for
  premium research" (TechCrunch, Jun 11 2026) — a tailwind for exactly our model.

**Conclusion:** "a scored safety check over x402" is commoditized at 10× lower
price. The wedge must move to things a freshly-prompted agent + free APIs
**structurally cannot do**.

## 2. What free/cheap scanners structurally miss (the science)

- **~35.5% of real rug pulls show NO code-level risk** (229/645 incidents executed
  purely via unlocked liquidity — [arXiv 2506.18398](https://arxiv.org/html/2506.18398v3)).
  Bytecode/honeypot checks (GoPlus, honeypot.is — what an agent can replicate for
  free) miss over a third of rugs. **Behavioral/transaction analysis is required**
  — exactly our holders/funding/deployer layer.
- **GoPlus detected only 7,172 of 11,943 (~60%) advanced honeypot ("Trapdoor")
  tokens**; honeypot.is can't classify when a buy can't be simulated (empty
  liquidity / trading suspended) — [arXiv 2309.04700](https://arxiv.org/pdf/2309.04700),
  verified against the PDF.
- **60.9% of scam tokens live < 24h; 24.4% live < 1h** (same paper, verified).
  Pull-based checking is structurally late. **Latency/push is a genuine need, not
  a nice-to-have.**
- **Temporal data leakage invalidates most claimed detection accuracy** — any
  analysis using post-collapse data inflates performance
  ([arXiv 2602.21529](https://arxiv.org/html/2602.21529v1)). A track record is
  only credible if logged **point-in-time, pre-event**. Our `rugwatch.ts` already
  does exactly this → rare credible-accuracy positioning.

## 3. Distribution facts (Bazaar / Agentic.Market — all verified)

- Coinbase launched **Agentic.Market (Apr 20, 2026)**: public no-auth marketplace
  for x402 services; auto-indexed on first CDP-settled payment (we qualify).
- **Curated services rank above auto-indexed ones** (~70 curated at launch, incl.
  OpenAI, Anthropic, CoinGecko, Alchemy in our "Data"/"Trading" categories).
  Getting curated is a free distribution lever.
- The marketplace **publicly displays live usage metrics** (total calls, unique
  payers, last-active) — traction itself is a visible trust signal.
- **30-day inactivity → delisted from Bazaar results.** We need steady paid call
  volume just to stay discoverable → argues for a cheap high-frequency tier.
- Bazaar has its own MCP discovery endpoint (`/v2/x402/discovery/mcp`) and
  x402bazaar.org ships an aggregator MCP server (112+ APIs behind one install) —
  agents increasingly discover tools via aggregators, not per-vendor npm packages.

## 4. Roadmap — ranked by (impact on agent demand × solo/$0 feasibility)

| # | Feature | Why it's a moat | Cost |
|---|---------|-----------------|------|
| 1 | **Verifiable point-in-time track record as the product's face** — extend `rugwatch.ts` to log *every* score (not just AVOIDs) pre-event; publish rolling precision stats ("X% of AVOIDs rugged ≤72h; Y% of HOTs didn't"); free `/api/track-record` + landing/`/t/` surfacing | Leakage-free accuracy is rare & credible (arXiv 2602.21529); Agentic.Market makes trust signals visible; competitors show no accuracy proof | ~0, existing KV |
| 2 | **Lifecycle watch + webhook alerts** — `/api/watch/{address}` (x402-paid registration): re-score on cron, POST webhook on tier change / LP pull / owner tax-switch ("rug-in-progress") | 60.9% of scams die <24h → polling agents are structurally late; continuous monitoring is what a prompted agent can't do; serves the real job-to-be-done (agents *hold* positions, need exit signals) | Low (cron exists; webhook POSTs, no long-lived conns) |
| 3 | **Deployer/wallet reputation graph as accumulated data** — persist every deployer, funding cluster, serial-rug linkage observed daily; expose `/api/deployer/{address}` | Time-accumulated proprietary data; gets better every day; a fresh agent prompt cannot reconstruct months of Base launch history | Low (KV; data already computed per-scan, just persist) |
| 4 | **Tiered pricing + quick-check endpoint** — `/api/quick/{address}` at ~$0.005 (cached/feed-grade) vs $0.03 deep score; keep batch at $0.10 | Competes with 0.003-USDC rivals on entry price while upselling depth; sustained call volume keeps us listed (30-day rule) and pumps public usage metrics | Trivial (re-price cached feed data) |
| 5 | **Get curated on Agentic.Market + Bazaar metadata polish** — outreach to CDP team, enrich OpenAPI/Bazaar metadata, accuracy stats in description | Curated > auto-indexed in ranking; zero-cost distribution | ~0 (outreach + metadata) |
| 6 | **Backtest / point-in-time history endpoint** — `/api/history?from=…&tier=…` serving past scores as logged (never recomputed) | Lets agent devs *prove to themselves* the signal is worth paying for; leakage-free backtest data is something free APIs don't offer | Low (serve rugwatch snapshots) |
| 7 | **Positioning rewrite** — from "token safety check" (commoditized) to **"the launch-lifecycle risk desk with a public, verifiable hit rate"**; lead every surface (landing, OpenAPI description, MCP tool descriptions, /caught) with the accuracy stats | Differentiates on the one axis rivals can't copy quickly: proof | ~0 (copy) |
| 8 | *(later)* **Behavioral-signal emphasis in marketing** — publish a short "35% of rugs have no code risk — here's what code scanners miss" post with our funding-cluster/sniper signals as the answer; Farcaster distribution | Educates the market into our wedge; cites independent research | ~0 (content) |

**Explicit non-goals (don't relitigate):** multi-chain expansion (GoPlus owns
breadth; our edge is Base depth), ML scoring (deterministic + explainable is the
trust story), raw new-pairs feed (DexScreener owns it), price war below ~$0.005
(race to the bottom vs 0.003-USDC bundlers we can't win on price).

## 5. Sequencing

1. **Sprint A (trust):** #1 track record + #7 positioning + #4 quick tier — all
   cheap, all compounding, all visible on Agentic.Market.
2. **Sprint B (stickiness):** #2 watch/webhooks + #3 reputation persistence.
3. **Sprint C (conversion):** #6 backtest endpoint + #5 curation outreach + #8 content.

## Key verified sources

- https://github.com/GoPlusSecurity/goplus-mcp · https://github.com/fernsugi/x402-api-mcp-server · https://quantumshield-api.vercel.app/
- https://docs.cdp.coinbase.com/x402/bazaar · https://www.coinbase.com/developer-platform/discover/launches/agentic-market · https://www.x402bazaar.org/
- https://arxiv.org/pdf/2309.04700 (Trapdoor; lifetimes, GoPlus 60%) · https://arxiv.org/html/2506.18398v3 (35.5% no-code-risk rugs) · https://arxiv.org/html/2602.21529v1 (temporal leakage)
- https://www.chainalysis.com/blog/x402-agentic-payments-adoption/ (PING speculation; $1+ tx 49%→95%)
- https://techcrunch.com/2026/06/11/coinbase-debuts-ai-agent-that-can-trade-and-pay-for-premium-research/
