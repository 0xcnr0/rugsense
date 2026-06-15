import type { Metadata } from "next";
import { getRecentBaseLaunchPairs } from "@/lib/dexscreener";
import { scoreLaunches } from "@/lib/scoring";
import { getScoreboard } from "@/lib/rugwatch";
import type { Tier } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HOME = "https://rugsense.xyz/mini";
const IMG = "https://rugsense.xyz/mini/opengraph-image";
const C = { bg: "#0b0d12", card: "#11141b", line: "#1c212b", text: "#e6e8eb", dim: "#9aa0a6", faint: "#6b7280", accent: "#4f8cff" };
const tierColor: Record<Tier, string> = { HOT: "#16c784", WATCH: "#f5a623", AVOID: "#ea3943" };

// Farcaster / Base Mini App embed — a shared link renders a "Launch" card.
const embed = {
  version: "1",
  imageUrl: IMG,
  button: {
    title: "Open RugSense",
    action: { type: "launch_miniapp", url: HOME, name: "RugSense", splashBackgroundColor: C.bg },
  },
};
const frameEmbed = { ...embed, button: { ...embed.button, action: { ...embed.button.action, type: "launch_frame" } } };

export const metadata: Metadata = {
  title: "RugSense — Base launch radar (mini app)",
  description: "Today's HOT Base launches + the rugs we filtered, with a verifiable hit rate. Scored, in your pocket.",
  openGraph: { title: "RugSense", description: "Scored Base launch intelligence with a verifiable track record.", images: [IMG] },
  other: { "fc:miniapp": JSON.stringify(embed), "fc:frame": JSON.stringify(frameEmbed) },
};

export default async function Mini() {
  const [pairs, board] = await Promise.all([getRecentBaseLaunchPairs(14), getScoreboard()]);
  const all = scoreLaunches(pairs).sort((a, b) => b.composite - a.composite);
  const hot = all.filter((l) => l.tier === "HOT").slice(0, 4);
  const watch = all.filter((l) => l.tier === "WATCH").slice(0, 3);
  const avoidCount = all.filter((l) => l.tier === "AVOID").length;
  const avoidPrec = board.avoid.precisionPct;
  const safeClean = board.safe.cleanPct;

  return (
    <main style={{ maxWidth: 440, margin: "0 auto", padding: "18px 14px 40px", color: C.text }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 19, fontWeight: 800 }}>RugSense</span>
        <span style={{ color: C.faint, fontSize: 12 }}>Base launch radar</span>
      </div>

      {/* Verifiable scoreboard */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <Chip label="AVOID precision" value={avoidPrec === null ? "—" : `${avoidPrec}%`} color={tierColor.AVOID} />
        <Chip label="HOT/WATCH clean" value={safeClean === null ? "—" : `${safeClean}%`} color={tierColor.HOT} />
        <Chip label="Resolved" value={String(board.totalResolved)} color={C.text} />
      </div>

      <Section title={`🔥 HOT now (${hot.length})`}>
        {hot.length ? hot.map((l) => <Row key={l.pairAddress} a={l.address} sym={l.symbol} name={l.name} tier={l.tier} score={l.composite} />)
          : <Empty text="No HOT launches right now — mostly noise." />}
      </Section>

      {watch.length > 0 && (
        <Section title={`🟡 Worth a look (${watch.length})`}>
          {watch.map((l) => <Row key={l.pairAddress} a={l.address} sym={l.symbol} name={l.name} tier={l.tier} score={l.composite} />)}
        </Section>
      )}

      <p style={{ color: C.faint, fontSize: 12.5, marginTop: 14 }}>
        Filtered <strong style={{ color: tierColor.AVOID }}>{avoidCount}</strong> as AVOID this scan
        (low liquidity / honeypot / pullable LP / concentrated).
      </p>

      <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
        <a href="https://rugsense.xyz/caught" style={btn}>Track record</a>
        <a href="https://rugsense.xyz" style={{ ...btn, borderColor: C.accent, color: C.accent }}>Full site →</a>
      </div>
      <p style={{ color: C.faint, fontSize: 11, marginTop: 14 }}>
        Quick scoring shown; the API runs the deep onchain assessment. Risk filter, not a guarantee. Not financial advice.
      </p>
    </main>
  );
}

function Chip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ flex: 1, background: C.card, border: `1px solid ${C.line}`, borderRadius: 10, padding: "9px 10px" }}>
      <div style={{ color: C.faint, fontSize: 10.5 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color }}>{value}</div>
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ color: C.dim, fontSize: 13, fontWeight: 600, margin: "0 0 6px" }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{children}</div>
    </div>
  );
}
function Row({ a, sym, name, tier, score }: { a: string; sym: string; name: string; tier: Tier; score: number }) {
  return (
    <a href={`https://rugsense.xyz/t/${a}`} style={{ textDecoration: "none", color: C.text, background: C.card, border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ color: tierColor[tier], fontWeight: 700, fontSize: 12, minWidth: 48 }}>{tier}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <strong>${sym || "?"}</strong>
        <span style={{ color: C.faint, fontSize: 12, marginLeft: 6 }}>{name?.slice(0, 18)}</span>
      </span>
      <span style={{ fontWeight: 700 }}>{score}</span>
    </a>
  );
}
function Empty({ text }: { text: string }) {
  return <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 10, padding: "12px 14px", color: C.dim, fontSize: 13 }}>{text}</div>;
}
const btn: React.CSSProperties = { border: `1px solid ${C.line}`, color: C.text, textDecoration: "none", padding: "9px 14px", borderRadius: 10, fontSize: 13.5, fontWeight: 600 };
