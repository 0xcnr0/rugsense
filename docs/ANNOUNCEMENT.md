# Announcement drafts — RugSense

Drafts for the public launch. **Nothing here is auto-posted** — review, edit, and post
yourself. Honest framing: no fake numbers; the `/caught` track record fills over days.

## Timing
The strongest differentiator is the **public track record** (`/caught`) — but it starts
empty and only fills as flagged launches actually rug (calendar time; the daily cron
confirms them). Two honest options:
- **Wait ~3–7 days** for a few real catches, then announce with receipts (strongest).
- **Announce now as "building in public"** — link the live, transparent `/caught` and
  invite people to watch it fill. Weaker proof, earlier momentum.

Recommended: prep now, announce with the first 2–3 real catches on `/caught`.

---

## A. Farcaster (Base-native builder/degen audience)

**Single cast:**
> Most "new pairs" feeds just show you what launched. RugSense tells you whether to touch it.
>
> Every fresh Base token → one AVOID / WATCH / HOT decision. Deterministic, no LLM, with a
> transparent per-signal breakdown you can audit.
>
> Free human reports + a per-call API agents pay over x402. 🔎 rugsense.xyz

**Thread (if you want depth):**
1. Most launch feeds are raw. GoPlus gives you 30 checks. Neither gives an agent a single
   decision it can act on. RugSense does: AVOID / WATCH / HOT in one call. rugsense.xyz
2. 13+ deterministic signals — honeypot/tax sim, owner-mutable sell switches, sniper/bundle
   supply, funding-source wallet clusters, graph centrality, serial-deployer history, LP
   lock + duration. Every score ships the per-signal checks[] so you see *why*.
3. The part that compounds: a repeat-offender wallet denylist built from rugs we catch. When
   a deployer's prior tokens rugged, the next launch gets flagged before it does. Watch it
   here → rugsense.xyz/caught
4. For agents: one x402 call ($0.03), or drop our MCP server into AgentKit / LangChain in a
   few lines. No keys, no signup — your agent's wallet pays per call. Docs: rugsense.xyz/openapi.json
5. Not financial advice, a risk filter not a guarantee. But your agent should never buy a
   fresh launch blind again.

---

## B. X / Twitter

**Thread:**
1. Launching RugSense 🔎 — pre-trade rug/honeypot intelligence for fresh Base tokens.
   Every launch scored into ONE machine-actionable decision: AVOID / WATCH / HOT.
   Deterministic. Transparent. Paid per call over x402. rugsense.xyz
2. Raw "new pairs" feeds tell you *what* launched. Security APIs give you 30 disconnected
   checks. RugSense gives an agent the one thing it needs: a decision + calibrated confidence
   it can gate on — with the full per-signal breakdown so you can audit it.
3. 13+ onchain/behavioral signals: honeypot & tax sim, latent honeypot (owner can flip
   sells/tax later), sniper/bundle supply, coordinated-funding wallet clusters, tx-graph
   centrality, serial-deployer history, LP burn/lock + DURATION.
4. The moat that compounds: a repeat-offender wallet denylist built from rugs WE catch.
   Public, timestamped track record → rugsense.xyz/caught
5. Built for agents: 1 x402 call, or our MCP server in AgentKit / LangChain.
   get_base_launches · check_base_token · check_base_tokens_batch. No keys, no signup.
6. Solo-built, live on Base mainnet, ~$0 infra. Risk filter, not a guarantee — DYOR.

---

## C. Dev-focused (agent builders — Warpcast /dev channels, x402/AgentKit communities)

> Building a Base trading/research agent? Don't let it buy a fresh launch blind.
>
> RugSense scores any Base token into AVOID/WATCH/HOT with a transparent checks[] + confidence
> your agent can gate on. One x402 call, or one line via MCP (AgentKit getMcpTools / LangChain
> langchain-mcp-adapters).
>
> ```ts
> const { token } = await (await fetchWithPay(`https://rugsense.xyz/api/token/${addr}`)).json();
> if (token.tier === "AVOID" || token.composite < 60) return skip();
> ```
>
> Deterministic, no LLM, no keys. Batch-screen a watchlist in one call too. Docs → rugsense.xyz/openapi.json

---

## Channels & next steps (need your accounts)
- **Farcaster:** post from your account; consider the /base and builder channels.
- **X:** your account; tag @base / x402 ecosystem where natural.
- **MCP registries (the competitor's distribution edge):** publish to Smithery / Glama /
  npm so `npx`-style install works. Needs: a public GitHub repo (we have no remote yet) +
  npm/Smithery accounts. Prep on request.
- **x402 Bazaar / Agentic.Market:** auto-lists on CDP settles; rich metadata already shipped.
