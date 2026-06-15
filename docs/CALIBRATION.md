# Scoring Calibration — methodology & current state

> The scoring thresholds in `src/lib/scoring.ts` (`CFG`) were set from general
> ETH/BSC heuristics, not Base data. This doc is how we tune them honestly as our own
> leakage-free outcomes accrue — and a standing reminder NOT to overfit.

## The discipline

- **Source of truth:** `/api/history` (the leakage-free resolved-outcome log — every
  verdict snapshotted at score time, graded strictly later). Tool: `scripts/calibrate.ts`.
- **Don't tune on a handful of points.** Treat any per-bucket rate with **n < ~30** as
  anecdotal. Forcing a threshold change on 5 outcomes is overfitting, not calibration.
- **Trigger to retune:** when a verdict's rug rate contradicts its meaning at n≥30 — e.g.
  WATCH rugging about as often as AVOID, or an AVOID *survival* rate so high it means we're
  over-flagging (false positives). Then adjust the specific `CFG` knob and note it here.

## Current snapshot (June 2026 — n=5, ANECDOTAL)

Run `npx tsx scripts/calibrate.ts` for live numbers. As of writing:

| Verdict | n | rug rate | reading |
|---------|---|----------|---------|
| AVOID | 4 | 100% | good (we said avoid, they rugged) — but no AVOID has *survived* yet, so we can't yet see false-positive rate |
| WATCH | 1 | 100% | one miss — see below |
| HOT | 0 | — | none resolved yet |

Median time-to-rug: ~24h. Predictive flags so far: `LP_UNSECURED` (4/4 rugged),
`HIGH_ROTATION` (1/1). All anecdotal at this n.

## The one watch-item (not yet actionable)

The single non-AVOID miss was **$AGENT** — scored **WATCH** with top flag `HIGH_ROTATION`
($73k liquidity, rugged in 25h). `HIGH_ROTATION` (h1 volume ≥ liquidity) is treated as a
momentum positive, but extreme rotation on a young, low-safety-confidence token is also a
classic **wash-trading / pump-before-rug** tell. It got WATCH from feed-grade scoring,
which skips the Etherscan deployer/cluster signals (those run on `/api/token`).

**If, at n≥30, WATCH+HIGH_ROTATION keeps rugging:** dampen `volToLiqHot`'s contribution to
momentum, or require a minimum `safetyConfidence` before HIGH_ROTATION can lift a token to
WATCH. Until then: no change — restraint over overfitting.

## Threshold review (Base context)

The current `CFG` values look reasonable for Base and are left unchanged pending data:
`liqFloor 2k` / `liqGood 50k` / `liqGreat 500k`, `alphaWindow 240m`, `hotComposite 70` +
`hotSafety 60`, `safetyHardFloor 35`. Revisit each here when `scripts/calibrate.ts` shows
n≥30 in the relevant bucket.
