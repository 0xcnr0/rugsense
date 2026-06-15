# Distribution & Curation Plan

> The product is now differentiated (see `docs/AGENT-DEMAND-RESEARCH.md`). Distribution
> is the remaining lever. This doc is the checklist for getting RugSense discovered and
> chosen by agents — all $0, solo-executable.

## 1. Stay listed on Agentic.Market / x402 Bazaar

**Facts (verified):**
- Auto-indexed on first CDP-settled payment with the Bazaar discovery extension (we
  have it — `bazaarResourceServerExtension` in `src/lib/x402.ts`).
- **Curated services rank above auto-indexed ones.** ~70 curated at launch incl.
  OpenAI, Anthropic, CoinGecko, Alchemy in the Data/Trading categories.
- **30-day inactivity → delisted.** Steady paid call volume is required to stay visible.
- Per-service live metrics (total calls, unique payers, last-active) are public — our
  traction is itself a trust signal.

**Actions:**
- [ ] Apply for curation (human-readable metadata). Lead the pitch with the one thing
      incumbents don't show: **a public, verifiable hit rate** (`/api/track-record`).
- [ ] Keep call volume non-zero: the $0.005 quick tier exists partly to make
      high-frequency agent usage cheap enough that we never go 30 days idle.
- [ ] Verify each endpoint's `paymentPayload.resource` is the exact resource URL so all
      seven paid endpoints catalog correctly (middleware feed uses an explicit
      `routeTemplate`; route-level `withX402` endpoints settle on success).

## 2. MCP discoverability

- [ ] Republish `rugsense-mcp` v1.1.0 (7 tools now). `cd mcp && npm publish`.
- [ ] Smithery listing refresh (`mcp/smithery.yaml`) — surface the new tools.
- [ ] Make `get_rugsense_track_record` the gateway tool in docs: it's free, so an agent
      can evaluate our hit rate before wiring a wallet — lowers the trust barrier.

## 2b. ERC-8004 presence (new discovery channel — June 2026)

The ERC-8004 agent-trust stack is live on Base (150k+ agents; identity + reputation +
validation registries at `0x8004…`). Full analysis + cost/effort: `docs/ERC-8004.md`.

- [x] **L1 (free, done):** serve `/.well-known/agent-card.json` — RugSense is now parseable
      by ERC-8004 crawlers (8004scan, RNWY, Agent0 subgraph) and doubles as an A2A card.
- [ ] **L2 (cents):** run `scripts/register-8004.ts` with a funded Base hot wallet → mints
      our agent NFT in the Base Identity Registry. Then paste the printed `registrations[]`
      into the agent-card and redeploy.
- [ ] **L3 (defer):** on-chain token-risk validator (answer `validationResponse` 0-100).
      Trigger: agents actually sending per-token validation requests. Until then it's gas +
      infra with no consumer — keep output attestation-shaped so the lift stays small.

Competitive note: RedStone/Credora hold the infra/risk-intelligence layer here. We don't
out-breadth them — our edge stays Base-launch depth + the verifiable track record, which is
the reputation signal that wins provider selection.

## 2c. Farcaster mini-app (shipped — needs one signing step)

`/mini` is a mobile Base/Farcaster mini-app (scoreboard + today's HOT/filtered, links to
reports). Embed meta (`fc:miniapp`/`fc:frame`) + dynamic image + manifest
(`/.well-known/farcaster.json`) are live. To finish registration:

- [ ] Sign `accountAssociation` with the Farcaster custody wallet that owns rugsense.xyz —
      Warpcast → Settings → Developer → Domains, or the base.dev manifest generator — and
      paste `header`/`payload`/`signature` into `public/.well-known/farcaster.json`, redeploy.
- [ ] (optional) Replace the placeholder `iconUrl` (currently the OG image) with a dedicated
      200×200 PNG.
- [ ] Then share a cast linking `https://rugsense.xyz/mini` — it renders a "Open RugSense"
      launch card. Pair with the `scripts/daily-content.ts` / `scripts/scoreboard-post.ts` output.

## 3. The positioning, everywhere

One line, repeated on landing, OpenAPI description, MCP tool descriptions, /caught:

> **The launch-lifecycle risk desk for Base — with a public, verifiable hit rate.**

Differentiate on the axis rivals can't copy quickly: **proof**. Free scanners (GoPlus
MCP, honeypot.is, QuantumShield, fernsugi's $0.003 scan_token) all sell *a check*. None
publish a leakage-free track record of how their calls resolved.

## 4. Content engine (Farcaster / X) — educate the market into our wedge

- [ ] Evergreen post: **"~35% of rugs have no code-level risk."** Free scanners check
      bytecode; pure unlocked-liquidity pulls slip through. Show our funding-cluster /
      sniper / deployer-history signals as the answer. Cite arXiv 2506.18398.
- [ ] Daily/weekly: auto-post the scoreboard delta ("this week: N AVOIDs flagged, M
      confirmed rugged, X% precision") straight from `/api/track-record`. The track
      record markets itself once it has volume.
- [ ] When a flagged AVOID rugs, post the receipt (link `/t/{address}` + `/caught`).

## 5. Why an agent dev buys instead of rolling their own

The honest pitch (don't oversell — the analysis IS replicable):
1. **Coverage:** behavioral signals they'd have to build (and backfill months of Base
   launch history for) to match — the deployer dossier compounds daily.
2. **Proof:** they can't audit their own hand-rolled checks the way they can read our
   `/api/history`. We've already graded thousands of calls point-in-time.
3. **Push:** `/api/watch` gives an exit signal without them standing up infra.
4. **Price:** $0.005 quick-check is cheaper than the RPC + honeypot.is calls they'd
   spend rolling it themselves per token.

## Non-goals (don't chase)
- Multi-chain breadth (GoPlus owns it; our edge is Base depth + track record).
- Price war below ~$0.005 (sub-cent bundlers exist; we don't win on price, we win on proof).
- ML scoring (deterministic + explainable + auditable is the trust story).
