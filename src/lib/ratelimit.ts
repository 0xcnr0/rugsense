import { redisExec, analyticsEnabled } from "./analytics";

// Lightweight per-IP fixed-window rate limit for the FREE endpoints (the only abuse
// vector — paid endpoints are gated by x402). Backed by the same Upstash/Vercel-KV REST.
// Fail-OPEN: with no store configured (or no resolvable IP) it always allows, so nothing
// breaks locally or on a fresh deploy. Generous by default; tune via RATE_LIMIT_RPM.

const DEFAULT_LIMIT = Number(process.env.RATE_LIMIT_RPM || "60"); // requests per window
const WINDOW_SEC = 60;

export interface RateResult {
  ok: boolean;
  limit: number;
  remaining: number;
  retryAfter: number; // seconds until the window resets (0 when ok)
}

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") || "unknown";
}

/** Count one hit for (bucket, ip) in the current fixed window. Fail-open. */
export async function rateLimit(
  bucket: string,
  ip: string,
  limit = DEFAULT_LIMIT,
  windowSec = WINDOW_SEC,
): Promise<RateResult> {
  if (!analyticsEnabled || ip === "unknown") return { ok: true, limit, remaining: limit, retryAfter: 0 };
  const nowSec = Math.floor(Date.now() / 1000);
  const win = Math.floor(nowSec / windowSec);
  const key = `rl:${bucket}:${ip}:${win}`;
  const res = await redisExec([
    ["INCR", key],
    ["EXPIRE", key, String(windowSec)],
  ]);
  const count = Number(res[0]?.result ?? 0);
  const remaining = Math.max(0, limit - count);
  const ok = count <= limit;
  return { ok, limit, remaining, retryAfter: ok ? 0 : windowSec - (nowSec % windowSec) };
}

/** Standard rate-limit response headers for a result. */
export function rateHeaders(r: RateResult): Record<string, string> {
  const h: Record<string, string> = {
    "x-ratelimit-limit": String(r.limit),
    "x-ratelimit-remaining": String(r.remaining),
  };
  if (!r.ok) h["retry-after"] = String(r.retryAfter);
  return h;
}
