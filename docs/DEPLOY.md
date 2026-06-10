# Deploy — public URL (Vercel)

Goal: get the endpoint on a public URL so agents (and the x402 Bazaar crawler) can
reach it. We deploy on **base-sepolia first** (free, no real money) to validate the
public path, then flip to mainnet (`docs/X402.md` Step 2).

## Why a public URL
`localhost` only works for you. The 402 response advertises the request URL as the
`resource` — agents must be able to reach it, and the facilitator settles against a
publicly reachable endpoint. Vercel gives a free `https://<project>.vercel.app`.

## One-time prerequisites
- A free Vercel account: https://vercel.com/signup
- Vercel CLI: `npm i -g vercel` (or use `npx vercel`)

## Deploy (from this folder)
```bash
cd /path/to/base-launch-radar
npx vercel login        # opens browser, one-time
npx vercel              # first run: link/create project, accept defaults → preview URL
```
The first `vercel` creates a Preview deployment. Use `npx vercel --prod` for the
production URL once you're happy.

## Set environment variables (Vercel)
Either in the dashboard (Project → Settings → Environment Variables) or via CLI:
```bash
npx vercel env add X402_ENABLED       # value: true
npx vercel env add X402_NETWORK        # value: base-sepolia   (mainnet later: base)
npx vercel env add X402_PAY_TO         # value: <your receiving wallet address> (seller)
npx vercel env add X402_PRICE          # value: 0.03
# Optional but recommended for RPC rate limits at scale:
npx vercel env add BASE_RPC_URL        # value: <an Alchemy/QuickNode Base RPC URL>
```
Re-deploy after adding env: `npx vercel --prod`.

> base-sepolia uses the free default x402.org facilitator — no CDP keys needed for
> this public-testnet validation.

## Verify the public deploy
```bash
# 1) Unpaid → 402 with payment requirements (resource should be your vercel.app URL):
curl -s -o /dev/null -w "%{http_code}\n" https://<project>.vercel.app/api/launches/latest
# expect 402

# 2) Paid round-trip against the public URL:
RADAR_URL=https://<project>.vercel.app/api/launches/latest?limit=3 \
BUYER_PRIVATE_KEY=0x<funded-sepolia-buyer> npx tsx scripts/buyer-test.ts
# expect HTTP 200 + scored launches
```

## Notes
- The `/api/launches/latest` route is `maxDuration = 60` (Hobby max) because onchain
  safety fans out RPC calls. If you see timeouts, set `BASE_RPC_URL` to a dedicated RPC
  and/or lower the discovery `limit`.
- Next step after a green public test: list on x402 Bazaar / Agentic.Market
  (see `docs/X402.md` Step 3), then flip to mainnet.
