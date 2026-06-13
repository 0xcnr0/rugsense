import { track, redisExec, analyticsEnabled } from "./analytics";
import { checkWallets } from "./reputation";
import type { ScoredLaunch } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Deployer dossier — accumulated, proprietary wallet history. Every scan already
// computes a deployer's recent-deployment count, wallet age, and prior-token
// outcomes (deployer.ts). On their own those are a snapshot. Persisted and
// accumulated across every launch we ever see, they become a record that compounds:
// "this wallet has shipped N tokens we've observed; M of their prior tokens are dead;
// first seen on <date>." A freshly-prompted agent cannot reconstruct months of Base
// launch history from free APIs — this is data, not analysis, and data is the moat.
//
// Storage (Upstash/Vercel-KV REST; no-op without creds):
//   dep:rec:<deployer>     JSON latest snapshot (deployments, ageDays, priorTokens, …)
//   dep:first:<deployer>   number firstSeen ms (NX — preserves the earliest sighting)
//   dep:tokens:<deployer>  SET of token addresses we've seen this deployer ship
// Writes are fire-and-forget on the hot path; reads are awaited for the endpoint.
// ─────────────────────────────────────────────────────────────────────────────

const ZERO = "0x0000000000000000000000000000000000000000";
const TOKENS_SHOWN = 25; // cap the token list we surface

export interface DeployerSnapshot {
  deployer: string;
  lastToken: { address: string; symbol: string };
  deployments: number | null; // recent contract-creation txs
  ageDays: number | null;
  priorTokens: number | null;
  priorRugged: number | null;
  lastSeen: number;
}

export interface DeployerDossier {
  found: boolean;
  deployer: string;
  queried: string; // what the caller passed (token or deployer)
  riskLevel: "high" | "elevated" | "low" | "unknown";
  onDenylist: boolean;
  denylistReason: string | null;
  tokensSeen: number; // distinct tokens we've observed from this deployer
  tokens: string[]; // up to TOKENS_SHOWN of them
  firstSeen: string | null;
  lastSeen: string | null;
  snapshot: DeployerSnapshot | null;
}

const parse = <T>(v: unknown): T | null => {
  if (typeof v !== "string") return null;
  try { return JSON.parse(v) as T; } catch { return null; }
};

/** Persist what a scan revealed about a launch's deployer (fire-and-forget). */
export function recordDeployers(launches: ScoredLaunch[], now: number = Date.now()): void {
  if (!analyticsEnabled) return;
  const cmds: string[][] = [];
  for (const l of launches) {
    const d = l.safety?.deployer;
    if (!d || d.toLowerCase() === ZERO) continue;
    const deployer = d.toLowerCase();
    const token = l.address.toLowerCase();
    const snap: DeployerSnapshot = {
      deployer,
      lastToken: { address: token, symbol: l.symbol },
      deployments: l.safety?.deployerDeployments ?? null,
      ageDays: l.safety?.deployerAgeDays ?? null,
      priorTokens: l.safety?.deployerPriorTokens ?? null,
      priorRugged: l.safety?.deployerPriorRugged ?? null,
      lastSeen: now,
    };
    cmds.push(["SET", `dep:rec:${deployer}`, JSON.stringify(snap)]);
    cmds.push(["SET", `dep:first:${deployer}`, String(now), "NX"]);
    cmds.push(["SADD", `dep:tokens:${deployer}`, token]);
  }
  if (cmds.length) track(cmds);
}

/** Read the accumulated dossier for a deployer EOA. */
export async function getDeployerDossier(deployer: string, queried: string): Promise<DeployerDossier> {
  const addr = deployer.toLowerCase();
  const base: DeployerDossier = {
    found: false, deployer: addr, queried: queried.toLowerCase(), riskLevel: "unknown",
    onDenylist: false, denylistReason: null, tokensSeen: 0, tokens: [], firstSeen: null, lastSeen: null, snapshot: null,
  };
  if (!analyticsEnabled) return base;

  const res = await redisExec([
    ["GET", `dep:rec:${addr}`],
    ["GET", `dep:first:${addr}`],
    ["SCARD", `dep:tokens:${addr}`],
    ["SMEMBERS", `dep:tokens:${addr}`],
  ]);
  const snap = parse<DeployerSnapshot>(res[0]?.result);
  const firstMs = Number(res[1]?.result ?? 0) || null;
  const tokensSeen = Number(res[2]?.result ?? 0);
  const tokens = ((res[3]?.result as string[] | undefined) ?? []).slice(0, TOKENS_SHOWN);

  const deny = await checkWallets([addr]);
  const denyRec = deny.get(addr) ?? null;

  const priorRugged = snap?.priorRugged ?? 0;
  let riskLevel: DeployerDossier["riskLevel"] = "unknown";
  if (denyRec) riskLevel = "high";
  else if (priorRugged && priorRugged > 0) riskLevel = "elevated";
  else if (snap) riskLevel = "low";

  return {
    found: !!snap || tokensSeen > 0 || !!denyRec,
    deployer: addr,
    queried: queried.toLowerCase(),
    riskLevel,
    onDenylist: !!denyRec,
    denylistReason: denyRec?.reason ?? null,
    tokensSeen,
    tokens,
    firstSeen: firstMs ? new Date(firstMs).toISOString() : null,
    lastSeen: snap ? new Date(snap.lastSeen).toISOString() : null,
    snapshot: snap,
  };
}
