# Security Audit & Pre-Mainnet Checklist

Audit before going to mainnet (real USDC). Covers code, secrets, payment path,
scoring-manipulation, DoS, and dependencies. Re-run before each major release.

## Attack surface — what we DON'T have (big de-risks)
- **No smart contracts of our own.** The app only *reads* third-party contracts via
  RPC. There is no contract of ours to exploit; the only "contract risk" is how we
  *interpret* other tokens (covered under Scoring manipulation).
- **No server-side private key.** x402 "receiving" is a public **address** only;
  settlement is done by the facilitator. The server never holds or signs with a key.
  → A server compromise cannot move funds.
- **No user accounts / PII / database of users.** Nothing to breach.

## Findings & status

### 1. Secrets & key hygiene — CLEAN in repo
- ✅ Only `.env.example` is tracked; real `.env`, `.env.local`, `.vercel` are gitignored.
- ✅ No hardcoded secrets in source; no secret committed in git history; no `NEXT_PUBLIC_*`
  leak (BASE_RPC_URL / CDP keys / x402 config are server-only).
- ⚠️ **Operational notes:**
  - The **buyer private key typed in the terminal during testing is a base-sepolia
    throwaway** (holds only worthless testnet USDC). It now lives in shell history +
    chat. **Never reuse it on mainnet.** Optionally clear it: `history -p` / edit `~/.zsh_history`.
  - **Going to mainnet needs NO private key typed anywhere** — `X402_PAY_TO` is just the
    receiving **address** (public). The only key ever entered was the test *buyer's*.
  - The **Alchemy RPC URL** (embeds a key) was pasted in chat and stored in Vercel
    (encrypted). Low sensitivity (rate-limited endpoint); rotate in the Alchemy dashboard
    if you want to be safe.
  - **CDP API secret** (for mainnet): add it via the **Vercel dashboard**, never paste it
    in a terminal/chat.

### 2. x402 payment path — SERVER-AUTHORITATIVE
- ✅ `withX402` verifies the payment via the facilitator server-side and settles **only on
  a successful (<400) response**; the scored body is never returned without a valid payment.
- ✅ Facilitator auto-selects CDP when `CDP_API_KEY_ID/SECRET` are set (required for mainnet).
- ℹ️ When `X402_ENABLED!=true` the endpoint is open by design (validation mode). Production = on.

### 3. Input validation / SSRF — CLEAN
- ✅ Query params `limit/tier/minSafety` are integer-clamped / whitelisted.
- ✅ All outbound calls use **fixed hosts** (DexScreener, honeypot.is, the configured RPC).
  No caller-controlled value flows into an outbound URL or RPC target. Token addresses come
  from DexScreener/onchain discovery, not user input.

### 4. Scoring manipulation — the core trust surface
- ✅ **FIXED (this audit): LP-lock gaming.** Previously "LP held by any contract" counted as
  "secured" (+15) — an attacker could send LP to a self-owned contract to fake a lock. Now
  only **burn (dead/zero) + KNOWN lockers** are credited; LP in an unknown contract is reported
  as `LP_LOCK_UNVERIFIED` with **no safety credit** (`src/lib/holders.ts`, `src/lib/assess.ts`).
- ✅ Safety-gating: a low-safety token is capped to AVOID regardless of momentum, so
  wash-trade volume can't lift a risky token to HOT.
- ⚠️ **Residual / documented limits (not blockers, but disclosed via `checks`+`confidence`):**
  - **v3 LP — now handled** (`src/lib/v3lock.ts`): resolves the position-NFT owner. EOA owner →
    `pullable` (danger), unverified contract → no safety credit (can't prove no-withdraw, can't be
    gamed), burn/known-locker → secured. Residual: the known-locker allowlist is conservative
    (empty until addresses are verified), so legit Clanker-locked tokens currently show
    "unverified" rather than a safety boost — under-credits safety, never over-credits it.
  - **honeypot.is dependency:** honeypot/tax come from an external API; a false-negative is
    inherited. Mitigated by our independent signals + the composite + graceful degradation
    (confidence drops if it's unavailable).
  - **DexScreener liquidity trust:** `liquidityUsd` is taken from DexScreener; a faked pool
    could mislead momentum. Safety signals (honeypot/holders/LP) are the guard.
- ➡️ **Honest framing for buyers:** the score is a *risk filter*, not a guarantee — every launch
  ships its per-signal `checks[]` + `safetyConfidence` so agents can set their own thresholds.

### 5. DoS / resource abuse — REASONABLE
- ✅ Paid endpoint (x402) is the primary abuse limiter; heavy RPC work is **gated to liquidity
  ≥ $5k**, concurrency-bounded, cached (10 min), `maxDuration=60`, retries bounded (3).
- ⚠️ **Recommend:** add a lightweight per-IP rate limit + short response cache for the
  open/free path so a burst can't exhaust the Alchemy/honeypot.is quota.

### 6. Error handling — CLEAN
- ✅ Failures degrade to `unknown` (lower confidence), never crash the response; clients get
  controlled JSON only — no stack traces / internal details leaked.

### 7. Dependencies — 25 moderate, ACCEPTED/MONITORED
- `npm audit`: 25 moderate vulns in **@reown/appkit + @walletconnect**, pulled transitively by
  `x402-next` → `x402` → `wagmi`. These are **browser wallet-connection UI** libs for x402's
  optional paywall page — **not executed in our server payment-verification path**, and our
  human UI is our own. `npm audit fix --force` would break the x402 integration. **Decision:
  accept + monitor; update when x402-next ships a fixed tree.** (`x402-fetch` is dev-only.)

## Pre-mainnet must-do checklist
- [ ] Use a **dedicated mainnet receiving wallet** for `X402_PAY_TO` (its address is public).
- [ ] Add `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` via the **Vercel dashboard** (not terminal/chat).
- [ ] Do **not** reuse the testnet buyer key; keep mainnet keys out of shell history & chat.
- [ ] Confirm `X402_ENABLED=true`, `X402_NETWORK=base`, price sane, before flipping.
- [ ] (Recommended) add a per-IP rate limit on `/api/launches/latest`.
- [ ] (Optional) rotate the Alchemy RPC key.

## Ongoing security tooling
- **`/security-review`** skill — run on each branch diff before merge.
- **`security-engineer`** agent — deep code-level audits for larger changes.
- `npm audit` in CI; this `SECURITY.md` is the living record — update on each release.
