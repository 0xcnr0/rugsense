// Lightweight usage analytics via Upstash Redis REST (works on serverless, no persistent
// connection). Env-gated: with no credentials it's a no-op, so nothing breaks until you
// add a free Upstash/Vercel-KV database. Tracking is fire-and-forget — never blocks a response.
//
// Set either Upstash names or Vercel-KV names:
//   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN   (Upstash)
//   KV_REST_API_URL + KV_REST_API_TOKEN                 (Vercel KV)

const URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

export const analyticsEnabled = !!(URL && TOKEN);

/** Fire-and-forget pipeline of Redis commands (e.g. [["INCR","calls:total"], …]). */
export function track(commands: string[][]): void {
  if (!URL || !TOKEN || commands.length === 0) return;
  void fetch(`${URL}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(commands),
    cache: "no-store",
  }).catch(() => {});
}

/** Run a Redis pipeline and return raw results (reads + writes). [] if unconfigured. */
export async function redisExec(commands: string[][]): Promise<{ result: unknown }[]> {
  if (!URL || !TOKEN || commands.length === 0) return [];
  try {
    const res = await fetch(`${URL}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify(commands),
      cache: "no-store",
    });
    return (await res.json()) as { result: unknown }[];
  } catch {
    return [];
  }
}

/** Record one paid API call (endpoint = "feed" | "token" | "quick" | "batch" | "deployer" | "watch"), with the tiers served. */
export function trackCall(endpoint: string, tiers: string[] = []): void {
  const day = new Date().toISOString().slice(0, 10);
  const cmds: string[][] = [
    ["INCR", "calls:total"],
    ["INCR", `calls:${endpoint}`],
    ["INCR", `calls:day:${day}`],
  ];
  for (const t of tiers) cmds.push(["INCR", `tier:${t}`]);
  track(cmds);
}

/** Read a set of counter keys → { key: number }. Empty if analytics not configured. */
export async function readCounters(keys: string[]): Promise<Record<string, number>> {
  if (!URL || !TOKEN || keys.length === 0) return {};
  try {
    const res = await fetch(`${URL}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify(keys.map((k) => ["GET", k])),
      cache: "no-store",
    });
    const data = (await res.json()) as { result: string | null }[];
    const out: Record<string, number> = {};
    keys.forEach((k, i) => (out[k] = Number(data[i]?.result ?? 0)));
    return out;
  } catch {
    return {};
  }
}
