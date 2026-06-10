import { track, redisExec, analyticsEnabled } from "./analytics";
import type { Flag } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Proprietary wallet-reputation flywheel — the part a competitor CANNOT copy.
//
// Public signals (honeypot, holders, LP) are commoditized. What compounds over
// time and stays defensible is a denylist of wallets WE have tied to rugs through
// our own operation: deployers of confirmed rugs (rugwatch), and serial-rugger
// deployers found by prior-token-outcome analysis (deployer.ts). When a fresh
// launch is touched (deployed / funded / held) by a wallet on this list, that's a
// near-certain repeat-offender signal that no snapshot scanner produces.
//
// Storage: the same Upstash/Vercel-KV REST as analytics (no-op without creds).
//   rep:wallets            SET of flagged wallet addresses (for cardinality)
//   rep:addr:<addr>        JSON { role, reason, token, at }
// The store only GROWS as we confirm more rugs — reliability improves with use.
// ─────────────────────────────────────────────────────────────────────────────

export type BadWalletRole = "deployer" | "funder" | "sniper" | "holder";

export interface BadWallet {
  addr: string;
  role: BadWalletRole;
  reason: string; // e.g. "deployer of confirmed rug", "serial rugger (4/5 prior tokens dead)"
  token: string; // the token address that earned the flag
  at: number; // ms
}

export function reputationEnabled(): boolean {
  return analyticsEnabled;
}

/** Add wallets to the denylist (fire-and-forget). NX preserves the first reason. */
export function flagWallets(entries: Omit<BadWallet, "at">[], now: number = Date.now()): void {
  if (!analyticsEnabled || entries.length === 0) return;
  const cmds: string[][] = [];
  for (const e of entries) {
    const addr = e.addr.toLowerCase();
    if (!addr || addr === "0x0000000000000000000000000000000000000000") continue;
    const rec: BadWallet = { ...e, addr, at: now };
    cmds.push(["SET", `rep:addr:${addr}`, JSON.stringify(rec), "NX"]);
    cmds.push(["SADD", "rep:wallets", addr]);
  }
  if (cmds.length) track(cmds);
}

const parse = <T>(v: unknown): T | null => {
  if (typeof v !== "string") return null;
  try { return JSON.parse(v) as T; } catch { return null; }
};

/** Look up which of these wallets are on the denylist → addr → record. */
export async function checkWallets(addrs: string[]): Promise<Map<string, BadWallet>> {
  const out = new Map<string, BadWallet>();
  if (!analyticsEnabled || addrs.length === 0) return out;
  const uniq = [...new Set(addrs.map((a) => a.toLowerCase()).filter(Boolean))];
  const res = await redisExec(uniq.map((a) => ["GET", `rep:addr:${a}`]));
  uniq.forEach((a, i) => {
    const rec = parse<BadWallet>(res[i]?.result);
    if (rec) out.set(a, rec);
  });
  return out;
}

/** Cardinality of the denylist (for the public track-record / stats). */
export async function reputationCount(): Promise<number> {
  if (!analyticsEnabled) return 0;
  const res = await redisExec([["SCARD", "rep:wallets"]]);
  return Number(res[0]?.result ?? 0);
}

/** Pure scoring of a reputation hit → delta + flags + check status + detail. */
export function reputationSignal(hits: { addr: string; rec: BadWallet }[]): {
  scoreDelta: number;
  flags: Flag[];
  status: "pass" | "warn" | "fail" | "unknown";
  detail: string;
} {
  if (hits.length === 0) {
    return { scoreDelta: 0, flags: [], status: "pass", detail: "no known-bad wallets involved" };
  }
  // A flagged deployer is the strongest hit; otherwise a flagged funder/holder.
  const deployerHit = hits.find((h) => h.rec.role === "deployer");
  if (deployerHit) {
    return {
      scoreDelta: -40, // repeat-offender deployer ⇒ force AVOID
      status: "fail",
      detail: `deployer linked to a prior rug (${deployerHit.rec.reason})`,
      flags: [{ code: "REPEAT_OFFENDER", label: "Deployer tied to a prior rug we caught", severity: "danger" }],
    };
  }
  return {
    scoreDelta: -18,
    status: "fail",
    detail: `${hits.length} wallet(s) linked to prior rugs`,
    flags: [{ code: "KNOWN_BAD_WALLETS", label: `${hits.length} holder/funder wallet(s) tied to prior rugs`, severity: "danger" }],
  };
}
