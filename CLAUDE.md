# CLAUDE.md — RugSense

> This file orients any new Claude Code / Antigravity session opened in this
> folder. Read it first, then `docs/PLAN.md` and `docs/BUSINESS-MODEL.md`.

## What this project is
An **agent-native scored launch-intelligence API for Base**. It discovers freshly
launched Base tokens, scores them (safety + momentum → composite → `AVOID/WATCH/HOT`),
and sells access **per-call over x402 (USDC on Base)**. Buyers: AI agents (via x402
Bazaar / Agentic.Market) and humans (landing page / future Farcaster mini-app).

This is a **separate project** from the user's NFT collection (that lives in a
different repo: `../ai-nft-base/`, developed in another window). Do not mix them.

## Why it exists (settled decisions — don't relitigate)
- Goal: low budget (~$0) → direct revenue; not heavy DeFi; independent from NFT.
- Elided "general token security API" niche — owned by GoPlus + Token Sniffer/DEXTools.
- NOT a raw "new pairs" feed — DexScreener owns that, free. **Wedge = the scored
  AVOID/WATCH/HOT decision in one x402 call** (gap between DexScreener=raw/human and
  GoPlus=security-only).
- Data source: **onchain DEX factory events** (Aerodrome + Uniswap v2/v3 via Base RPC)
  for discovery, enriched via DexScreener free per-token API.

## Architecture
```
onchain factory events (src/lib/onchain.ts, viem + Base RPC)   ← discovery
        → DexScreener enrich (src/lib/dexscreener.ts)          ← liquidity/vol/age
        → assess.ts orchestrates safety signals + scoring.ts          ← THE MOAT, no LLM
          ├ honeypot.ts (honeypot.is sim) · safety.ts (bytecode + latent honeypot)
          ├ holders.ts (concentration · sniper/bundle · graph centrality)
          ├ deployer.ts · funding.ts (Etherscan V2, etherscan.ts client)
          └ v3lock.ts · lockduration.ts (LP lock + duration)
        → GET /api/launches/latest (feedcache.ts, 45s TTL)     ← ranked feed (x402)
        → GET /api/token/[address]                             ← score one token (x402)
        → / landing (src/app/page.tsx)                         ← human storefront
        → mcp/server.ts (get_base_launches, check_base_token)  ← agent MCP tools
```
**x402 v2:** `src/lib/x402.ts` (x402ResourceServer + CDP facilitator + bazaar ext). The FEED
is gated by `paymentProxy` middleware (`src/middleware.ts`, correct Bazaar routeTemplate); the
TOKEN endpoint uses route-level `withX402` (settles on success → 404 not charged). Spec:
`public/openapi.json` → `/openapi.json`.

## Status (as of this session)
- [x] MVP works end-to-end: build + typecheck + live test pass.
- [x] Scoring engine validated (`npm run score:demo`, `scripts/verify-live.ts`).
- [x] Business model written (`docs/BUSINESS-MODEL.md`).
- [x] Hardened safety assessment (`src/lib/assess.ts` orchestrates): honeypot + buy/sell
  tax + source-verified + proxy (honeypot.is), mint/blacklist/pause + ownership
  (`safety.ts` bytecode/RPC), holder concentration + LP burn/lock (`holders.ts`, Transfer-log
  reconstruction). Transparent per-signal `checks[]` + `safetyConfidence`. Heavy holder/LP
  work gated to liquidity ≥ $5k. v2 LP via holder reconstruction; **v3 LP via the
  position-NFT owner** (`src/lib/v3lock.ts`): EOA owner → pullable/danger, unverified
  contract → no credit, burn/known-locker → secured. **RPC note:** use a provider with
  large `eth_getLogs` ranges — Alchemy free caps at 10 blocks (breaks it); we use
  **PublicNode** (`BASE_RPC_URL=https://base.publicnode.com`, set on Vercel).
- [x] **Behavioral scoring layer (research-driven, deterministic, no ML)** — six new signals
  folded into `assess.ts` with transparent `checks[]`, each pure-scored + unit-tested:
  **deployer reputation** (`deployer.ts`: serial-deployer recidivism + throwaway-wallet age via
  Etherscan V2), **sniper/bundle** supply grabbed in opening blocks + first-block buyers
  (`holders.ts`), **funding-source cluster** (top holders funded from one source in a tight
  window, `funding.ts`, CEX false-positive guard), **graph centrality** (one wallet seeding a
  large share of holders, `holders.ts`), **LP-lock duration** (permanent vs timed,
  `lockduration.ts`), **latent honeypot** (owner-mutable sell/tax switches, ownership-gated,
  `safety.ts`). Etherscan-backed signals (deployer, cluster) need a FREE `ETHERSCAN_API_KEY`
  and degrade to `unknown` (no score impact, not counted against confidence) without it.
- [x] x402 wired via `withX402` (env-gated); CDP facilitator auto-selected when CDP keys set.
- [x] **🟢 LIVE ON MAINNET & EARNING:** https://rugsense.xyz — Vercel
  project `0xcnrs-projects/base-launch-radar`. Prod env: `X402_ENABLED=true`,
  `X402_NETWORK=base`, `X402_PAY_TO=<X402_PAY_TO — your receiving wallet, set in Vercel>`
  (receiving), `X402_PRICE=0.03`, `BASE_RPC_URL=https://base.publicnode.com`, CDP keys set.
  First real mainnet payment confirmed (HTTP 200, USDC settled via CDP). Security audit
  done (`SECURITY.md`); pre-mainnet checklist cleared.
- [x] Security audit complete (`SECURITY.md`): no server key / no own contracts; secrets
  clean; LP-gaming fixed; deps 25 moderate transitive (accepted).
- [x] **Human funnel + marketing surfaces (free, alongside the paid API):**
  **Shareable per-token report page** `src/app/t/[address]/page.tsx` (`/t/0x…` — tier,
  scores, per-signal `checks[]`, key facts, agent CTA, dynamic OG/Twitter card; landing
  rows link to it). **Public "rugs we caught" track record** `src/app/caught/page.tsx`
  (`/caught`) backed by `src/lib/rugwatch.ts` (record AVOID-with-rug-reason launches →
  daily `/api/cron/recheck` confirms which rugged via liquidity collapse / pool removal;
  `vercel.json` cron, self-feeding: discovers+records then confirms). Uses existing
  Upstash/KV plumbing (no-op without creds). Optional `CRON_SECRET` env hardens the cron.
- [x] **Production hardening:** per-IP rate limit on the free endpoints (`src/lib/ratelimit.ts`,
  Upstash-backed, fail-open, `RATE_LIMIT_RPM`); signed webhooks (HMAC over `${ts}.${body}` via
  `x-rugsense-signature`/`-timestamp`, env `WATCH_WEBHOOK_SECRET`); `/api/stats` now counts all
  endpoints with per-endpoint revenue.
- [x] **Free/Pro storefront:** `/pricing` (`src/app/pricing/page.tsx`) — Free / Pay-per-call (x402) /
  Pro (honest waitlist, no fake billing). Nav links added on landing.
- [x] **Farcaster mini-app:** `/mini` (`src/app/mini/page.tsx`) mobile surface (scoreboard + today's
  HOT/filtered), dynamic embed image (`src/app/mini/opengraph-image.tsx`, ImageResponse, asset-free),
  `fc:miniapp`/`fc:frame` embed meta, manifest `public/.well-known/farcaster.json`. **USER TODO:**
  sign `accountAssociation` with the Farcaster custody wallet for rugsense.xyz (Warpcast Developer
  Domains / base.dev manifest tool) + paste it in; optionally swap the placeholder icon for a 200x200 PNG.
- [x] **Calibration tooling:** `scripts/calibrate.ts` (rug rate per verdict/flag from `/api/history`,
  n<30 anecdotal guard) + `docs/CALIBRATION.md`. Thresholds deliberately UNCHANGED (n too small).
- [ ] **Next:** confirm x402 Bazaar / Agentic.Market listing (auto after first CDP settle); ERC-8004
  L2 register (user, `scripts/register-8004.ts`); curation outreach + content (`docs/CONTENT.md`);
  recalibrate scoring once `scripts/calibrate.ts` shows n≥30; wire daily/weekly content auto-poster.

## Endpoints (paid = x402 v2 USDC on Base; two are free)
- `GET /api/launches/latest` — ranked scored feed ($0.03, paymentProxy middleware)
- `GET /api/token/{address}` — deep-score one token incl. Etherscan deployer/cluster + reputation ($0.03, withX402)
- `GET /api/quick/{address}` — fast DexScreener-grade pre-screen, no onchain deep-dive ($0.005, withX402) — high-frequency triage tier
- `GET /api/tokens/batch?addresses=…` — feed-grade score up to 20 tokens ($0.10, withX402)
- `GET /api/watch/{address}?callback=…` — register 7-day lifecycle monitoring; webhook POST on tier-change / rug-in-progress ($0.05, withX402). Engine: `src/lib/watchalerts.ts`, drained by the cron via `runWatchAlerts`
- `GET /api/deployer/{address}` — accumulated deployer dossier (tokens shipped, prior-rug outcomes, first-seen, denylist) ($0.02, withX402). Store: `src/lib/deployerstore.ts` (`recordDeployers` from feed + token route)
- `GET /api/track-record` — **FREE** verifiable point-in-time hit rate (scoreboard). Leakage-free by construction
- `GET /api/history` — **FREE** leakage-free backtest log of resolved verdicts (filter by verdict/outcome)
- MCP (`mcp/server.ts`, **v1.1.0**): `get_base_launches`, `check_base_token`, `quick_check_base_token`, `check_base_tokens_batch`, `watch_base_token`, `get_base_deployer_dossier`, `get_rugsense_track_record` (7 tools, x402-paying). **npm → `npx -y rugsense-mcp`** (`mcp/package.json` + `mcp/smithery.yaml`, `mcp/dist` gitignored, built on publish — bump + republish for v1.1.0)
- **The moat (post-research):** behavioral signals catch the ~35% of rugs with no code-level risk; the **verifiable leakage-free track record** (rugwatch logs EVERY verdict pre-event, grades strictly later → `getScoreboard`/`getResolvedOutcomes`) is the one axis a freshly-prompted agent + free APIs can't reproduce. Full analysis: `docs/AGENT-DEMAND-RESEARCH.md`
- Free human surfaces: `/` landing, `/t/[address]` report, `/caught` track record (now shows the verifiable scoreboard)
- Distribution: rich OpenAPI (`/openapi.json`) + Bazaar metadata; curation outreach + content plan in `docs/DISTRIBUTION.md`; AgentKit/LangChain snippets in `docs/INTEGRATE.md`
- **ERC-8004 agent-trust stack (LIVE on Base, 150k+ agents — analysis in `docs/ERC-8004.md`):** L1 done = `/.well-known/agent-card.json` (free, makes us crawlable by 8004scan/RNWY/Agent0). L2 ready = `scripts/register-8004.ts` (one `register()` tx on Base Identity Registry `0x8004A169…`, cents of gas, needs a funded Base hot wallet — run it, then paste the printed `registrations[]` into the agent-card + redeploy). L3 deferred = on-chain token-risk validator (`validationResponse` is 0-100; build when agents actually send per-token validation requests). NOTE: this corrects the old "ERC-8004 = no proven demand, defer" stance — it's now live + adopted.

## Run
```bash
npm install
npm run score:demo            # verify scoring (no network)
npx tsx scripts/verify-live.ts # live: onchain discovery → enrich → score
npm run dev                   # http://localhost:3000 + /api/launches/latest
```

## Key facts for revenue
- Pricing: $0.03/call (agents), Pro ~$15/mo (humans planned). See `docs/BUSINESS-MODEL.md`.
- **Live on mainnet, earning per-call USDC.** First real payment confirmed. Receiving
  wallet: `<X402_PAY_TO — your receiving wallet, set in Vercel>`. Distribution is the next lever.
- Full plan + research basis: `docs/PLAN.md`. Go-live details: `docs/X402.md`.
