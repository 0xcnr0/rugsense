import { getRecentBaseLaunchPairs } from "@/lib/dexscreener";
import { scoreLaunches } from "@/lib/scoring";
import type { ScoredLaunch, Tier } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const tierColor: Record<Tier, string> = { HOT: "#16c784", WATCH: "#f5a623", AVOID: "#ea3943" };
const C = { bg: "#0b0d12", card: "#11141b", line: "#1c212b", text: "#e6e8eb", dim: "#9aa0a6", faint: "#6b7280", accent: "#4f8cff" };

// Human-facing storefront (the "content = marketing" channel). Same scoring engine as
// the paid agent API — humans browse the radar, agents pay per call over x402.
export default async function Home() {
  // Fast (DexScreener-only) scoring for the public teaser — keeps the page snappy.
  // The full onchain safety assessment (honeypot/holder/LP + checks + confidence) is
  // the paid API's value, not given away free here.
  const launches = scoreLaunches(await getRecentBaseLaunchPairs(15)).sort(
    (a, b) => b.composite - a.composite,
  );
  const counts = { HOT: 0, WATCH: 0, AVOID: 0 } as Record<Tier, number>;
  launches.forEach((l) => (counts[l.tier] += 1));

  return (
    <main style={{ maxWidth: 920, margin: "0 auto", padding: "40px 20px 64px" }}>
      {/* Hero */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 30 }}>RugSense</h1>
        <span style={{ color: C.dim, fontSize: 13 }}>scored launch intelligence · live on Base · paid per call over x402</span>
        <a href="/caught" style={{ color: C.accent, fontSize: 13, textDecoration: "none", marginLeft: "auto" }}>Rugs we caught →</a>
      </div>
      <p style={{ color: C.text, fontSize: 17, lineHeight: 1.5, maxWidth: 680, marginTop: 12 }}>
        Every freshly-launched token, scored for <strong>safety</strong> and{" "}
        <strong>momentum</strong> into one <strong>AVOID / WATCH / HOT</strong> decision —
        so you (or your agent) skip the rugs and catch the real ones, in a single call.
      </p>
      <p style={{ color: C.dim, fontSize: 14, maxWidth: 680 }}>
        Not a raw &ldquo;new pairs&rdquo; feed. A scored decision: honeypot &amp; tax simulation,
        deployer reputation, sniper/bundle detection, wallet-cluster &amp; graph analysis, holder
        concentration, and LP burn/lock with duration (v2 &amp; v3) — each launch ships a
        transparent per-signal <code>checks[]</code> and a <code>safetyConfidence</code>.
      </p>

      {/* Tier summary */}
      <div style={{ display: "flex", gap: 10, margin: "20px 0 8px" }}>
        {(["HOT", "WATCH", "AVOID"] as Tier[]).map((t) => (
          <div key={t} style={{ flex: 1, background: C.card, border: `1px solid ${C.line}`, borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ color: tierColor[t], fontWeight: 700, fontSize: 13, letterSpacing: 0.5 }}>{t}</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{counts[t]}</div>
          </div>
        ))}
      </div>

      {/* Live table */}
      <h2 style={{ fontSize: 16, color: C.dim, margin: "24px 0 8px", fontWeight: 600 }}>
        Latest scored launches{" "}
        <span style={{ color: C.faint, fontWeight: 400, fontSize: 13 }}>
          — quick view; full onchain safety (honeypot/holder/LP + per-signal checks) ships with the API
        </span>
      </h2>
      {launches.length === 0 ? (
        <p style={{ color: C.dim }}>No launches resolved right now — try again shortly.</p>
      ) : (
        <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
            <thead>
              <tr style={{ textAlign: "left", color: C.faint, borderBottom: `1px solid ${C.line}` }}>
                {["Token", "Tier", "Score", "Safety", "Mom.", "Liq.", "Age", "Flags"].map((h) => (
                  <th key={h} style={{ padding: "10px 8px", fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {launches.map((l) => (
                <Row key={l.pairAddress} l={l} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* For agents / developers */}
      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 20, marginTop: 28 }}>
        <h2 style={{ margin: "0 0 8px", fontSize: 17 }}>For agents &amp; developers</h2>
        <p style={{ color: C.dim, fontSize: 14, marginTop: 0 }}>
          One x402 call returns the scored, ranked list. No API keys, no signup — your agent&apos;s
          wallet pays <strong>$0.03 USDC</strong> per call on Base.
        </p>
        <pre style={{ background: C.bg, border: `1px solid ${C.line}`, borderRadius: 8, padding: 12, overflowX: "auto", fontSize: 12.5, color: C.text }}>
{`GET /api/launches/latest?tier=HOT&minSafety=60   → ranked scored launches   $0.03
GET /api/token/{address}                         → deep-score one token       $0.03
GET /api/tokens/batch?addresses=0x..,0x..        → pre-screen up to 20 tokens  $0.10
402 Payment Required (x402 v2) → pay USDC → data`}
        </pre>
        <p style={{ color: C.dim, fontSize: 13.5 }}>
          Discoverable on the <span style={{ color: C.accent }}>x402 Bazaar / Agentic.Market</span>.
          Drop-in <strong>MCP server</strong> gives any MCP client a <code>get_base_launches</code>{" "}
          tool. Specs: <a href="/openapi.json" style={{ color: C.accent }}>/openapi.json</a>,{" "}
          <code>docs/INTEGRATE.md</code>.
        </p>
      </div>

      {/* How the score works */}
      <div style={{ marginTop: 28 }}>
        <h2 style={{ margin: "0 0 10px", fontSize: 17 }}>How the score works</h2>
        <p style={{ color: C.dim, fontSize: 14, marginTop: 0 }}>
          Deterministic, no LLM. Every launch runs through a battery of behavioral &amp; contract
          signals; a single dangerous one (honeypot, pullable LP, mintable, serial deployer) caps the
          composite to <strong>AVOID</strong> no matter how strong the momentum.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
          {[
            ["Honeypot + tax", "buy/sell trade simulation"],
            ["Deployer reputation", "serial-deployer & throwaway-wallet history"],
            ["Sniper / bundle", "supply grabbed in the opening blocks"],
            ["Funding cluster", "top holders funded from one source"],
            ["Graph centrality", "one wallet seeding many holders"],
            ["Latent honeypot", "owner-mutable sell/tax switches"],
            ["Source verified", "contract is open-source"],
            ["Proxy / upgradeable", "can the logic change?"],
            ["Mint / blacklist / pause", "dangerous functions in bytecode"],
            ["Ownership", "renounced, or owner can act?"],
            ["Holder concentration", "top-10 % + whale count"],
            ["LP burn / lock + duration", "pullable? permanent or timed? (v2 + v3)"],
            ["Momentum", "liquidity, volume rotation, buyers"],
          ].map(([t, d]) => (
            <div key={t} style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{t}</div>
              <div style={{ color: C.faint, fontSize: 12 }}>{d}</div>
            </div>
          ))}
        </div>
        <p style={{ color: C.faint, fontSize: 12.5, marginTop: 10 }}>
          Each launch returns the per-signal <code>checks[]</code> (pass/warn/fail/unknown) plus a{" "}
          <code>safetyConfidence</code>, so you see <em>why</em> — not just a number.
        </p>
      </div>

      <p style={{ color: C.faint, fontSize: 12, marginTop: 24 }}>
        Scores are a risk filter, not a guarantee — DYOR. Not financial advice.
      </p>
    </main>
  );
}

function Row({ l }: { l: ScoredLaunch }) {
  const danger = l.flags.filter((f) => f.severity === "danger").map((f) => f.code);
  const info = l.flags.filter((f) => f.severity === "info").map((f) => f.code);
  const cell: React.CSSProperties = { padding: "9px 8px", borderBottom: `1px solid ${C.bg}` };
  return (
    <tr>
      <td style={cell}>
        <a href={`/t/${l.address}`} style={{ color: C.text, textDecoration: "none" }}>
          <strong>{l.symbol || "?"}</strong>
          <span style={{ color: C.faint, marginLeft: 6, fontSize: 12 }}>{l.name?.slice(0, 18)}</span>
        </a>
      </td>
      <td style={{ ...cell, color: tierColor[l.tier], fontWeight: 700 }}>{l.tier}</td>
      <td style={{ ...cell, fontWeight: 600 }}>{l.composite}</td>
      <td style={cell}>{l.safetyScore}</td>
      <td style={cell}>{l.momentumScore}</td>
      <td style={cell}>{l.liquidityUsd ? `$${Math.round(l.liquidityUsd).toLocaleString()}` : "—"}</td>
      <td style={{ ...cell, color: C.faint }}>{l.ageMinutes !== null ? `${l.ageMinutes}m` : "—"}</td>
      <td style={{ ...cell, fontSize: 11 }}>
        {danger.length > 0 && <span style={{ color: tierColor.AVOID }}>{danger.slice(0, 2).join(" ")}</span>}
        {danger.length === 0 && info.length > 0 && <span style={{ color: C.faint }}>{info.slice(0, 2).join(" ")}</span>}
      </td>
    </tr>
  );
}
