import type { Metadata } from "next";
import { isAddress } from "viem";
import { getPairsForToken, primaryPair } from "@/lib/dexscreener";
import { scoreLaunch, scoreLaunchOnchain } from "@/lib/scoring";
import type { CheckStatus, ScoredLaunch, Tier } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const tierColor: Record<Tier, string> = { HOT: "#16c784", WATCH: "#f5a623", AVOID: "#ea3943" };
const statusColor: Record<CheckStatus, string> = { pass: "#16c784", warn: "#f5a623", fail: "#ea3943", unknown: "#6b7280" };
const statusMark: Record<CheckStatus, string> = { pass: "✓", warn: "!", fail: "✕", unknown: "·" };
const C = { bg: "#0b0d12", card: "#11141b", line: "#1c212b", text: "#e6e8eb", dim: "#9aa0a6", faint: "#6b7280", accent: "#4f8cff" };

// Human-readable labels for the per-signal checks[] keys.
const CHECK_LABELS: Record<string, string> = {
  honeypot: "Honeypot (sell simulation)",
  tax: "Buy / sell tax",
  verified: "Source verified",
  proxy: "Proxy / upgradeable",
  mint: "Mint function",
  ownership: "Ownership",
  trade_controls: "Latent honeypot (owner switches)",
  deployer: "Deployer reputation",
  holder_concentration: "Holder concentration",
  snipers: "Sniper / bundle",
  centrality: "Wallet-graph centrality",
  cluster: "Funding-source cluster",
  lp_secured: "LP burned / locked",
};
const CHECK_ORDER = Object.keys(CHECK_LABELS);

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const { address } = await params;
  if (!isAddress(address)) return { title: "Token report — RugSense" };
  const pair = primaryPair(await getPairsForToken(address));
  if (!pair) return { title: "Token not found — RugSense" };
  // Fast (DexScreener-only) scoring is enough for the social-card tier/headline.
  const s = scoreLaunch(pair);
  const sym = s.symbol || shortAddr(address);
  const title = `$${sym} — ${s.tier} · RugSense`;
  const desc = `RugSense scored $${sym} ${s.tier} (safety ${s.safetyScore}/100). Onchain safety + momentum for fresh Base launches, in one call.`;
  return {
    title,
    description: desc,
    openGraph: { title, description: desc, url: `https://rugsense.xyz/t/${address}` },
    twitter: { card: "summary", title, description: desc },
  };
}

export default async function TokenReport({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;

  if (!isAddress(address)) return <Shell><Empty title="Invalid address" body="Provide a valid Base token address (0x + 40 hex)." /></Shell>;

  const pair = primaryPair(await getPairsForToken(address));
  if (!pair) return <Shell><Empty title="No pool found" body="No Base DEX pair resolved for this token yet." /></Shell>;

  const token = await scoreLaunchOnchain(pair);
  return <Shell><Report token={token} address={address} /></Shell>;
}

function Report({ token: l, address }: { token: ScoredLaunch; address: string }) {
  const checks = [...l.checks].sort((a, b) => CHECK_ORDER.indexOf(a.key) - CHECK_ORDER.indexOf(b.key));
  const danger = l.flags.filter((f) => f.severity === "danger");
  const warn = l.flags.filter((f) => f.severity === "warn");
  const s = l.safety;

  return (
    <>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <a href="/" style={{ color: C.accent, fontSize: 13, textDecoration: "none" }}>← RugSense</a>
        <span style={{ color: C.faint, fontSize: 13 }}>token report</span>
      </div>

      {/* Hero */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
        <div style={{ background: tierColor[l.tier], color: "#0b0d12", fontWeight: 800, fontSize: 18, padding: "6px 14px", borderRadius: 8, letterSpacing: 0.5 }}>
          {l.tier}
        </div>
        <div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>${l.symbol || "?"}<span style={{ color: C.faint, fontWeight: 400, fontSize: 15, marginLeft: 8 }}>{l.name}</span></div>
          <div style={{ color: C.faint, fontSize: 12, fontFamily: "monospace" }}>{address}</div>
        </div>
      </div>

      {/* Score bar */}
      <div style={{ display: "flex", gap: 10, margin: "18px 0 6px" }}>
        <ScoreCard label="Composite" value={l.composite} big />
        <ScoreCard label="Safety" value={l.safetyScore} />
        <ScoreCard label="Momentum" value={l.momentumScore} />
        <ScoreCard label="Confidence" value={l.safetyConfidence} suffix="%" muted />
      </div>
      {l.safetyPartial && (
        <p style={{ color: C.faint, fontSize: 12 }}>⚠ Some safety checks couldn&apos;t run (low confidence) — treat with extra caution.</p>
      )}

      {/* Danger / warn flags */}
      {(danger.length > 0 || warn.length > 0) && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "12px 0" }}>
          {danger.map((f) => <Pill key={f.code} color={tierColor.AVOID} text={f.label} />)}
          {warn.map((f) => <Pill key={f.code} color={tierColor.WATCH} text={f.label} />)}
        </div>
      )}

      {/* Key facts */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, margin: "14px 0" }}>
        <Fact label="Liquidity" value={l.liquidityUsd ? `$${Math.round(l.liquidityUsd).toLocaleString()}` : "—"} />
        <Fact label="Age" value={l.ageMinutes !== null ? `${l.ageMinutes}m` : "—"} />
        <Fact label="LP lock" value={s?.lpLockType ? (s.lpUnlocksInDays != null ? `${s.lpLockType} (${Math.round(s.lpUnlocksInDays)}d)` : s.lpLockType) : "—"} />
        <Fact label="Top-10 hold" value={s?.top10Pct != null ? `${s.top10Pct.toFixed(0)}%` : "—"} />
        {s?.deployer && <Fact label="Deployer" value={shortAddr(s.deployer)} />}
        {s?.deployerPriorTokens != null && s.deployerPriorTokens > 0 && (
          <Fact label="Deployer record" value={`${s.deployerPriorRugged ?? 0}/${s.deployerPriorTokens} prior rugged`} />
        )}
        {s?.sniperPct != null && <Fact label="Sniped at launch" value={`${s.sniperPct.toFixed(0)}%`} />}
      </div>

      {/* Per-signal checks */}
      <h2 style={{ fontSize: 15, color: C.dim, margin: "20px 0 8px", fontWeight: 600 }}>Per-signal checks</h2>
      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
        {checks.map((c, i) => (
          <div key={c.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderTop: i ? `1px solid ${C.bg}` : "none" }}>
            <span style={{ color: statusColor[c.status], fontWeight: 800, width: 16, textAlign: "center" }}>{statusMark[c.status]}</span>
            <span style={{ fontSize: 13.5, flex: 1 }}>{CHECK_LABELS[c.key] ?? c.key}</span>
            <span style={{ color: C.faint, fontSize: 12 }}>{c.detail ?? c.status}</span>
          </div>
        ))}
      </div>

      {/* Agent CTA */}
      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, marginTop: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>For agents</div>
        <p style={{ color: C.dim, fontSize: 13, margin: 0 }}>
          Get this as structured JSON in one x402 call — no signup, your agent&apos;s wallet pays $0.03 USDC:
        </p>
        <pre style={{ background: C.bg, border: `1px solid ${C.line}`, borderRadius: 8, padding: 10, overflowX: "auto", fontSize: 12, color: C.text, marginTop: 8 }}>
{`GET https://rugsense.xyz/api/token/${address}`}
        </pre>
      </div>

      <p style={{ color: C.faint, fontSize: 12, marginTop: 18 }}>
        {l.dexscreenerUrl && (<><a href={l.dexscreenerUrl} style={{ color: C.accent }}>View on DexScreener</a> · </>)}
        Scored {new Date(l.scoredAt).toUTCString()}. A risk filter, not a guarantee — DYOR. Not financial advice.
      </p>
    </>
  );
}

function ScoreCard({ label, value, suffix = "", big = false, muted = false }: { label: string; value: number; suffix?: string; big?: boolean; muted?: boolean }) {
  return (
    <div style={{ flex: big ? 1.4 : 1, background: C.card, border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ color: C.faint, fontSize: 11, letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: big ? 28 : 22, fontWeight: 700, color: muted ? C.dim : C.text }}>{value}{suffix}</div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 12px" }}>
      <div style={{ color: C.faint, fontSize: 11 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function Pill({ color, text }: { color: string; text: string }) {
  return <span style={{ border: `1px solid ${color}`, color, fontSize: 12, padding: "3px 9px", borderRadius: 999 }}>{text}</span>;
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 0" }}>
      <a href="/" style={{ color: C.accent, fontSize: 13, textDecoration: "none" }}>← RugSense</a>
      <h1 style={{ fontSize: 22, marginTop: 24 }}>{title}</h1>
      <p style={{ color: C.dim }}>{body}</p>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 20px 64px", color: C.text }}>{children}</main>;
}
