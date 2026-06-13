import type { Metadata } from "next";
import { getTrackRecord, getScoreboard, type RugCatch } from "@/lib/rugwatch";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const C = { bg: "#0b0d12", card: "#11141b", line: "#1c212b", text: "#e6e8eb", dim: "#9aa0a6", faint: "#6b7280", accent: "#4f8cff", red: "#ea3943" };

const FLAG_LABEL: Record<string, string> = {
  HONEYPOT: "Honeypot", EXTREME_TAX: "Extreme tax", LP_UNSECURED: "Pullable LP",
  SNIPED: "Sniped supply", HIGH_CONCENTRATION: "Whale concentration",
  SERIAL_DEPLOYER: "Serial deployer", COORDINATED_WALLETS: "Coordinated wallets",
  STAR_DISTRIBUTION: "Insider distribution", MINTABLE: "Mintable supply",
};

export const metadata: Metadata = {
  title: "Rugs we caught — RugSense",
  description: "Base launches RugSense flagged AVOID that later rugged — public, timestamped track record.",
  openGraph: { title: "Rugs we caught — RugSense", description: "Launches we flagged AVOID that later rugged — public track record.", url: "https://rugsense.xyz/caught" },
  twitter: { card: "summary", title: "Rugs we caught — RugSense", description: "Launches we flagged AVOID that later rugged — public track record." },
};

export default async function Caught() {
  const [tr, board] = await Promise.all([getTrackRecord(60), getScoreboard()]);
  const avoidPrec = board.avoid.precisionPct;
  const safeClean = board.safe.cleanPct;

  return (
    <main style={{ maxWidth: 820, margin: "0 auto", padding: "32px 20px 64px", color: C.text }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <a href="/" style={{ color: C.accent, fontSize: 13, textDecoration: "none" }}>← RugSense</a>
        <span style={{ color: C.faint, fontSize: 13 }}>track record</span>
      </div>

      <h1 style={{ fontSize: 28, margin: "16px 0 6px" }}>Verifiable track record</h1>
      <p style={{ color: C.dim, fontSize: 15, maxWidth: 660, marginTop: 0 }}>
        Every verdict below was snapshotted <em>at the moment we scored it</em> and graded{" "}
        <strong>strictly afterward</strong> — so these numbers can&rsquo;t be inflated by hindsight.
        Point-in-time receipts, not promises. <a href="/api/track-record" style={{ color: C.accent }}>JSON</a> ·{" "}
        <a href="/api/history" style={{ color: C.accent }}>backtest log</a>.
      </p>

      {/* Verifiable hit rate */}
      <div style={{ display: "flex", gap: 10, margin: "18px 0 12px", flexWrap: "wrap" }}>
        <Stat label="AVOID precision" value={avoidPrec === null ? "—" : `${avoidPrec}%`} color={C.red} sub={`${board.avoid.rugged}/${board.avoid.resolved} resolved rugged`} />
        <Stat label="HOT/WATCH clean" value={safeClean === null ? "—" : `${safeClean}%`} color="#23c562" sub={`${board.safe.survived}/${board.safe.resolved} survived`} />
        <Stat label="Verdicts resolved" value={board.totalResolved} sub="followed to outcome" />
      </div>

      {/* Catch counts */}
      <div style={{ display: "flex", gap: 10, margin: "0 0 22px", flexWrap: "wrap" }}>
        <Stat label="Rugs caught" value={tr.caughtCount} color={C.red} />
        <Stat label="Flagged AVOID" value={tr.flaggedCount} />
        <Stat label="Watching now" value={tr.watchingCount + board.safe.watching} muted />
      </div>

      {tr.catches.length === 0 ? (
        <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 24, textAlign: "center" }}>
          <p style={{ color: C.dim, margin: 0 }}>
            {tr.watchingCount > 0
              ? `Track record is warming up — ${tr.watchingCount} flagged launch(es) under watch. Confirmed catches appear here as they rug.`
              : "Track record is warming up — flagged launches will appear here once confirmed rugged."}
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {tr.catches.map((c) => <CatchRow key={c.address} c={c} />)}
        </div>
      )}

      <p style={{ color: C.faint, fontSize: 12, marginTop: 24 }}>
        &ldquo;Rugged&rdquo; = liquidity fell below 35% of the flagged value, or the pool was removed.
        A risk filter, not a guarantee — DYOR. Not financial advice.
      </p>
    </main>
  );
}

function Stat({ label, value, color, muted, sub }: { label: string; value: number | string; color?: string; muted?: boolean; sub?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 150, background: C.card, border: `1px solid ${C.line}`, borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ color: C.faint, fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: color ?? (muted ? C.dim : C.text) }}>{value}</div>
      {sub ? <div style={{ color: C.faint, fontSize: 11, marginTop: 2 }}>{sub}</div> : null}
    </div>
  );
}

function CatchRow({ c }: { c: RugCatch }) {
  const when = new Date(c.scoredAt).toISOString().slice(0, 10);
  return (
    <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 10, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 180 }}>
        <a href={`/t/${c.address}`} style={{ color: C.text, textDecoration: "none", fontWeight: 700 }}>
          ${c.symbol || "?"}<span style={{ color: C.faint, fontWeight: 400, fontSize: 12, marginLeft: 6 }}>{c.name?.slice(0, 20)}</span>
        </a>
        <div style={{ color: C.faint, fontSize: 12, marginTop: 2 }}>
          flagged AVOID {when} · ${c.liqAtScore.toLocaleString()} liq → ${c.liqAtCatch.toLocaleString()}
        </div>
      </div>
      <span style={{ border: `1px solid ${C.red}`, color: C.red, fontSize: 12, padding: "3px 9px", borderRadius: 999 }}>
        {FLAG_LABEL[c.topFlag] ?? c.topFlag}
      </span>
      <span style={{ color: C.red, fontWeight: 700, fontSize: 14, minWidth: 64, textAlign: "right" }}>−{c.dropPct}%</span>
    </div>
  );
}
