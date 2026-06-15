import { createHmac } from "crypto";
import { redisExec, analyticsEnabled } from "./analytics";
import { getPairsForToken, primaryPair } from "./dexscreener";
import { scoreLaunch } from "./scoring";
import type { Tier } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle watch — push, not pull. The job an agent actually has isn't "score this
// once", it's "tell me when this position turns". 60%+ of scam tokens die within 24h
// (arXiv 2309.04700), so a polling agent is structurally late. A registered watch is
// re-scored on the cron and POSTs a webhook the moment the verdict changes or a rug is
// in progress (liquidity collapse / pool removed). That's continuous monitoring a
// freshly-prompted agent cannot stand up on its own — and it's sticky revenue.
//
// Storage (Upstash/Vercel-KV REST; no-op without creds):
//   watch:hook:<id>   JSON WatchHook {id,address,symbol,url,baseTier,lastTier,lastLiq,...}
//   watch:due         ZSET (score = nextCheckAt ms) of hook ids due for a recheck
// id is deterministic over (address,url) so re-registering the same pair is idempotent.
// ─────────────────────────────────────────────────────────────────────────────

const WATCH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // a registration monitors for 7 days
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // recheck a hook at most ~hourly
const RUG_LIQ_FRACTION = 0.35; // liquidity below this fraction of last seen ⇒ rug alert
const MAX_FIRES = 25; // safety cap on webhook deliveries per hook

export interface WatchHook {
  id: string;
  address: string;
  symbol: string;
  url: string;
  baseTier: Tier; // tier at registration
  lastTier: Tier; // tier at the most recent check
  lastLiq: number; // liquidity (usd) at the most recent check
  registeredAt: number;
  expiresAt: number;
  fires: number;
}

export interface RegisterResult {
  ok: boolean;
  id?: string;
  address: string;
  tier?: Tier;
  liquidityUsd?: number | null;
  expiresAt?: string;
  error?: string;
}

// djb2 — a tiny deterministic hash so the id is stable per (address,url) without
// needing Math.random (unavailable here) and so re-registration is idempotent.
function hookId(address: string, url: string): string {
  const s = `${address.toLowerCase()}|${url}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

const parse = <T>(v: unknown): T | null => {
  if (typeof v !== "string") return null;
  try { return JSON.parse(v) as T; } catch { return null; }
};

function validCallback(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Register a token + callback for lifecycle monitoring. Idempotent per (address,url):
 * re-registering refreshes the expiry. Caller (the route) has already confirmed the
 * token has a pool and supplies its current tier + liquidity.
 */
export async function registerWatch(
  address: string,
  url: string,
  tier: Tier,
  liquidityUsd: number | null,
  symbol: string,
  now: number = Date.now(),
): Promise<RegisterResult> {
  const addr = address.toLowerCase();
  if (!validCallback(url)) return { ok: false, address: addr, error: "callback must be a valid http(s) URL" };
  if (!analyticsEnabled) {
    // No store configured → can't monitor. Be honest rather than silently accept.
    return { ok: false, address: addr, error: "watch store not configured on this deployment" };
  }
  const id = hookId(addr, url);
  const expiresAt = now + WATCH_WINDOW_MS;
  const hook: WatchHook = {
    id, address: addr, symbol, url,
    baseTier: tier, lastTier: tier, lastLiq: Math.round(liquidityUsd ?? 0),
    registeredAt: now, expiresAt, fires: 0,
  };
  await redisExec([
    ["SET", `watch:hook:${id}`, JSON.stringify(hook)],
    ["ZADD", "watch:due", String(now + CHECK_INTERVAL_MS), id],
  ]);
  return { ok: true, id, address: addr, tier, liquidityUsd, expiresAt: new Date(expiresAt).toISOString() };
}

async function postWebhook(url: string, payload: unknown): Promise<boolean> {
  try {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "user-agent": "RugSense-Watch/1.0",
    };
    // Sign so the receiver can verify the call is really from us. Signature is over
    // `${timestamp}.${body}` (timestamp guards against replay). Verify with:
    //   HMAC_SHA256(WATCH_WEBHOOK_SECRET, `${x-rugsense-timestamp}.${rawBody}`)
    //   === x-rugsense-signature.replace("sha256=","")
    const secret = process.env.WATCH_WEBHOOK_SECRET;
    if (secret) {
      const ts = String(Math.floor(Date.now() / 1000));
      const sig = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
      headers["x-rugsense-timestamp"] = ts;
      headers["x-rugsense-signature"] = `sha256=${sig}`;
    }
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Recheck the hooks due now: re-score each watched token and POST a webhook on a
 * tier change or a rug-in-progress; reschedule survivors; drop expired/maxed hooks.
 * Bounded per call. Returns counts.
 */
export async function runWatchAlerts(limit = 40, now: number = Date.now()): Promise<{ checked: number; fired: number; expired: number }> {
  if (!analyticsEnabled) return { checked: 0, fired: 0, expired: 0 };

  const res = await redisExec([["ZRANGEBYSCORE", "watch:due", "0", String(now), "LIMIT", "0", String(limit)]]);
  const ids = (res[0]?.result as string[] | undefined) ?? [];
  if (ids.length === 0) return { checked: 0, fired: 0, expired: 0 };

  const hookRes = await redisExec(ids.map((id) => ["GET", `watch:hook:${id}`]));
  let fired = 0;
  let expired = 0;
  const writes: string[][] = [];

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const hook = parse<WatchHook>(hookRes[i]?.result);
    if (!hook) { writes.push(["ZREM", "watch:due", id]); continue; }

    if (now > hook.expiresAt || hook.fires >= MAX_FIRES) {
      writes.push(["ZREM", "watch:due", id], ["DEL", `watch:hook:${id}`]);
      expired++;
      continue;
    }

    let curLiq: number | null;
    let newTier: Tier;
    try {
      const pair = primaryPair(await getPairsForToken(hook.address));
      if (!pair) { curLiq = null; newTier = "AVOID"; }
      else { curLiq = pair.liquidity?.usd ?? 0; newTier = scoreLaunch(pair).tier; }
    } catch {
      // transient error → just reschedule, don't drop
      writes.push(["ZADD", "watch:due", String(now + CHECK_INTERVAL_MS), id]);
      continue;
    }

    const poolGone = curLiq === null;
    const liq = curLiq ?? 0;
    const rug = poolGone || liq < hook.lastLiq * RUG_LIQ_FRACTION;
    const tierChanged = newTier !== hook.lastTier;

    if (rug || tierChanged) {
      const dropPct = hook.lastLiq > 0 ? Math.max(0, Math.round((1 - liq / hook.lastLiq) * 100)) : 0;
      const ok = await postWebhook(hook.url, {
        event: rug ? "rug_alert" : "tier_change",
        chain: "base",
        address: hook.address,
        symbol: hook.symbol,
        prevTier: hook.lastTier,
        tier: poolGone ? "AVOID" : newTier,
        prevLiquidityUsd: hook.lastLiq,
        liquidityUsd: poolGone ? 0 : Math.round(liq),
        dropPct,
        reason: poolGone ? "pool removed" : rug ? `liquidity −${dropPct}%` : `tier ${hook.lastTier} → ${newTier}`,
        firedAt: new Date(now).toISOString(),
      });
      if (ok) fired++;
    }

    const next: WatchHook = {
      ...hook,
      lastTier: poolGone ? "AVOID" : newTier,
      lastLiq: Math.round(liq),
      fires: hook.fires + (rug || tierChanged ? 1 : 0),
    };
    if (poolGone) {
      // Pool removed is terminal — stop watching.
      writes.push(["ZREM", "watch:due", id], ["DEL", `watch:hook:${id}`]);
      expired++;
    } else {
      writes.push(["SET", `watch:hook:${id}`, JSON.stringify(next)]);
      writes.push(["ZADD", "watch:due", String(now + CHECK_INTERVAL_MS), id]);
    }
  }

  if (writes.length) await redisExec(writes);
  return { checked: ids.length, fired, expired };
}
