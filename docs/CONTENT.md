# Ready-to-send copy (curation + social)

> Concrete, paste-ready text for the distribution steps that need a human (external
> forms / social accounts). Plan + checklist live in `docs/DISTRIBUTION.md`.

---

## A. Agentic.Market / x402 Bazaar curation request

**Where:** Coinbase Developer Platform → x402 / Agentic.Market curation (or reach the
CDP team via their developer Discord / the Agentic.Market "submit/curate" path).

**Service name:** RugSense
**URL:** https://rugsense.xyz · OpenAPI: https://rugsense.xyz/openapi.json
**Categories:** Data, Trading
**Network:** Base mainnet (eip155:8453), USDC via x402 v2 (CDP facilitator)

**One-liner:**
> The launch-lifecycle risk desk for Base — scores every freshly-launched token
> AVOID/WATCH/HOT in one x402 call, with a public, verifiable hit rate.

**Why curate us (the pitch):**
> Most token-safety services sell *a check*. RugSense is the only one that publishes a
> leakage-free, point-in-time track record of how its calls actually resolved
> (free: /api/track-record and /api/history) — every verdict is snapshotted at score
> time and graded strictly later, so the precision numbers can't be inflated by
> hindsight. We also cover the ~35% of rugs that have no code-level risk (wallet-behavior
> signals, not just bytecode), push webhook alerts on rug-in-progress (/api/watch), and
> expose an accumulating deployer-reputation dossier (/api/deployer). Deterministic, no
> LLM. Seven priced endpoints from $0.005, plus a free MCP discovery tool
> (get_rugsense_track_record) so agents can evaluate our hit rate before paying.

**Endpoints to list:** /api/quick ($0.005), /api/deployer ($0.02), /api/token ($0.03),
/api/launches/latest ($0.03), /api/watch ($0.05), /api/tokens/batch ($0.10);
free: /api/track-record, /api/history.

---

## B. Launch thread — X / Farcaster (v1.1.0)

**Post 1:**
> Any AI agent can run a honeypot check. That's table stakes now.
>
> So I rebuilt RugSense around the one thing an agent *can't* do for itself: a public,
> verifiable hit rate. Every call we make is graded — and the scoreboard is free to read.
>
> 🧵

**Post 2:**
> ~35% of rugs have NO code-level risk (arXiv 2506.18398). They're pure unlocked-liquidity
> pulls — a bytecode/honeypot scan sees nothing.
>
> RugSense reads wallet behavior instead: funding clusters, sniper bundles, deployer
> history, graph centrality. That's the coverage gap.

**Post 3:**
> Trust problem with third-party scores: how do you know they work?
>
> We snapshot every verdict at score time and grade it strictly later — zero hindsight
> leakage. Read the raw record yourself, no payment:
> rugsense.xyz/api/track-record · rugsense.xyz/api/history

**Post 4:**
> New in v1.1.0:
> • /api/quick — $0.005 fast pre-screen
> • /api/watch — webhook the moment a position turns (60%+ of scams die <24h; polling is
>   too late)
> • /api/deployer — accumulating dossier on every wallet we've watched ship a token
>
> MCP: npx -y rugsense-mcp (7 tools)

**Post 5:**
> All x402, USDC on Base, no API keys, no signup. Your agent's wallet pays per call.
>
> Free track record. Paid depth. Build on it: rugsense.xyz

---

## C. Evergreen educational post ("the 35% nobody scans")

> Your agent's rug check is probably blind to a third of rugs.
>
> A study of 645 real rug pulls found 229 of them (~35%) had no detectable code-level
> risk — no honeypot, no malicious function. They rugged purely by pulling unlocked
> liquidity. A bytecode scan (GoPlus, honeypot.is, the stuff a freshly-prompted agent
> wires up) returns "looks fine."
>
> The signal is in the *wallets*, not the contract: who funded the top holders, who
> sniped the opening blocks, what the deployer's prior tokens did. That's what RugSense
> scores. Free track record at rugsense.xyz/api/track-record.
>
> (source: arXiv 2506.18398)

---

## D. Weekly scoreboard auto-post (template — fill from /api/track-record)

> RugSense this week 📊 (point-in-time, graded after the fact)
> • AVOID precision: {avoid.precisionPct}%  ({avoid.rugged}/{avoid.resolved} resolved rugged)
> • HOT/WATCH stayed clean: {safe.cleanPct}%  ({safe.survived}/{safe.resolved})
> • Verdicts resolved to date: {totalResolved}
>
> Verify it yourself: rugsense.xyz/api/history

*(A small script can pull /api/track-record and fill this — same spirit as the existing
`scripts/daily-content.ts`.)*
