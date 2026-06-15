import { getRecentBaseLaunchPairs } from "@/lib/dexscreener";
import { scoreLaunches } from "@/lib/scoring";
import { getScoreboard } from "@/lib/rugwatch";
import type { ScoredLaunch, Tier } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const tierColor: Record<Tier, string> = { HOT: "#16c784", WATCH: "#f5a623", AVOID: "#ea3943" };
const C = { bg: "#0b0d12", card: "#11141b", line: "#1c212b", text: "#e6e8eb", dim: "#9aa0a6", faint: "#6b7280", accent: "#4f8cff", green: "#16c784" };

const GH = "https://github.com/0xcnr0/rugsense";
const NPM = "https://www.npmjs.com/package/rugsense-mcp";

// Human-facing storefront (content = marketing). Same scoring engine as the paid
// agent API — humans browse the radar, agents pay per call over x402.
export default async function Home() {
  // Fast (DexScreener-only) scoring for the public teaser — keeps the page snappy.
  // The full onchain assessment (incl. deployer reputation + the proprietary
  // repeat-offender denylist) is the paid API's value, not given away free here.
  const [launchPairs, board] = await Promise.all([getRecentBaseLaunchPairs(15), getScoreboard()]);
  const launches = scoreLaunches(launchPairs).sort((a, b) => b.composite - a.composite);
  const counts = { HOT: 0, WATCH: 0, AVOID: 0 } as Record<Tier, number>;
  launches.forEach((l) => (counts[l.tier] += 1));
  const avoidPrec = board.avoid.precisionPct;
  const safeClean = board.safe.cleanPct;

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "28px 20px 64px" }}>
      {/* Nav */}
      <nav style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 36 }}>
        <span style={{ fontSize: 20, fontWeight: 800 }}>RugSense</span>
        <span style={{ color: C.faint, fontSize: 12.5 }}>live on Base</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 16, fontSize: 13.5, flexWrap: "wrap" }}>
          <a href="/caught" style={link}>Track record</a>
          <a href="/pricing" style={link}>Pricing</a>
          <a href="#agents" style={link}>For agents</a>
          <a href="/openapi.json" style={link}>API</a>
          <a href={NPM} style={link}>npm</a>
          <a href={GH} style={link}>GitHub</a>
        </div>
      </nav>

      {/* Hero */}
      <h1 style={{ margin: 0, fontSize: 38, lineHeight: 1.15, maxWidth: 760 }}>
        The launch-lifecycle risk desk for Base — with a <span style={{ color: C.accent }}>verifiable</span> hit rate.
      </h1>
      <p style={{ color: C.text, fontSize: 18, lineHeight: 1.5, maxWidth: 720, marginTop: 16 }}>
        Any agent can run a honeypot check. RugSense does what a freshly-prompted agent can&apos;t:
        catches the <strong>~35% of rugs that have no code-level risk</strong> via wallet-behavior
        signals, follows every call to its outcome for a <strong>leakage-free track record</strong>,
        and <strong>pushes you a webhook</strong> when a position turns. One x402 call. No keys, no signup.
      </p>

      {/* Verifiable scoreboard strip */}
      <a href="/caught" style={{ textDecoration: "none", display: "block", marginTop: 18 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <ScoreChip label="AVOID precision" value={avoidPrec === null ? "warming up" : `${avoidPrec}%`} color={tierColor.AVOID} sub={`${board.avoid.rugged}/${board.avoid.resolved} resolved rugged`} />
          <ScoreChip label="HOT/WATCH stayed clean" value={safeClean === null ? "warming up" : `${safeClean}%`} color={C.green} sub={`${board.safe.survived}/${board.safe.resolved} survived`} />
          <ScoreChip label="Verdicts resolved" value={String(board.totalResolved)} color={C.text} sub="point-in-time, graded later →" />
        </div>
      </a>

      <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
        <a href="#agents" style={{ ...btn, background: C.accent, color: "#0b0d12", borderColor: C.accent }}>Add to your agent →</a>
        <a href="/caught" style={btn}>See the track record</a>
      </div>

      {/* Why different */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 12, marginTop: 40 }}>
        <Why title="Catches code-clean rugs">
          ~35% of rugs have <em>no</em> code-level risk — pure unlocked-liquidity pulls a honeypot
          check misses entirely. RugSense reads wallet behavior: funding clusters, sniper bundles,
          graph centrality, deployer history.
        </Why>
        <Why title="A hit rate you can audit">
          Every verdict is snapshotted at score time and graded <em>strictly later</em> — no
          hindsight inflation. The precision numbers are public at <code>/api/track-record</code> and{" "}
          <code>/api/history</code>.
        </Why>
        <Why title="Push, not pull + a moat that compounds">
          Register a token and we <code>webhook</code> you the moment it turns. And a proprietary
          repeat-offender denylist, grown from rugs <em>we catch</em> — the next launch by a known
          rugger is flagged before it pulls.
        </Why>
      </div>

      {/* Tier summary + live table */}
      <h2 style={{ fontSize: 16, color: C.dim, margin: "44px 0 8px", fontWeight: 600 }}>
        Live radar{" "}
        <span style={{ color: C.faint, fontWeight: 400, fontSize: 13 }}>
          — latest launches, quick view. Full onchain safety + deployer/reputation ships with the API.
        </span>
      </h2>
      <div style={{ display: "flex", gap: 10, margin: "0 0 10px" }}>
        {(["HOT", "WATCH", "AVOID"] as Tier[]).map((t) => (
          <div key={t} style={{ flex: 1, background: C.card, border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 14px" }}>
            <div style={{ color: tierColor[t], fontWeight: 700, fontSize: 13, letterSpacing: 0.5 }}>{t}</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{counts[t]}</div>
          </div>
        ))}
      </div>
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
      <p style={{ color: C.faint, fontSize: 12, marginTop: 8 }}>
        Click any token for its full report. The teaser uses fast scoring; the API runs the deep
        onchain assessment.
      </p>

      {/* For agents */}
      <div id="agents" style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 24, marginTop: 44 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 20 }}>Add to your agent in one line</h2>
        <p style={{ color: C.dim, fontSize: 14, marginTop: 0 }}>
          Drop the MCP server into Claude Desktop, Cursor, AgentKit or LangChain. Your agent&apos;s
          wallet pays per call over x402 — no API keys, no signup.
        </p>
        <pre style={code}>
{`{
  "mcpServers": {
    "rugsense": {
      "command": "npx",
      "args": ["-y", "rugsense-mcp"],
      "env": { "BUYER_PRIVATE_KEY": "0x<a Base wallet with USDC>" }
    }
  }
}`}
        </pre>
        <p style={{ color: C.dim, fontSize: 13, margin: "10px 0 4px" }}>
          Seven tools — <code>get_base_launches</code>, <code>check_base_token</code>,{" "}
          <code>quick_check_base_token</code>, <code>check_base_tokens_batch</code>,{" "}
          <code>watch_base_token</code>, <code>get_base_deployer_dossier</code>,{" "}
          <code>get_rugsense_track_record</code>. Or call the HTTP API directly:
        </p>
        <pre style={code}>
{`GET /api/quick/{address}                         → fast pre-screen one token  $0.005
GET /api/token/{address}                         → deep-score one token       $0.03
GET /api/tokens/batch?addresses=0x..,0x..        → pre-screen up to 20         $0.10
GET /api/launches/latest?tier=HOT&minSafety=60   → ranked scored feed          $0.03
GET /api/watch/{address}?callback=https://..     → webhook on tier change/rug  $0.05
GET /api/deployer/{address}                      → accumulated deployer dossier $0.02
GET /api/track-record   ·   GET /api/history     → verifiable hit rate          free`}
        </pre>
        <p style={{ color: C.dim, fontSize: 13, margin: "10px 0 4px" }}>How an agent gates on it:</p>
        <pre style={code}>
{`const { token } = await (await pay(\`/api/token/\${addr}\`)).json();
if (token.tier === "AVOID" || token.composite < 60) return skip();
swap();  // only HOT/WATCH with enough confidence`}
        </pre>
        <p style={{ color: C.faint, fontSize: 13, marginTop: 12 }}>
          Discoverable on the <span style={{ color: C.accent }}>x402 Bazaar / Agentic.Market</span> ·{" "}
          <a href="/openapi.json" style={link}>OpenAPI</a> ·{" "}
          <a href={NPM} style={link}>npm</a> ·{" "}
          <a href={GH} style={link}>source</a>
        </p>
      </div>

      {/* How the score works */}
      <div style={{ marginTop: 44 }}>
        <h2 style={{ margin: "0 0 10px", fontSize: 20 }}>How the score works</h2>
        <p style={{ color: C.dim, fontSize: 14, marginTop: 0, maxWidth: 720 }}>
          Deterministic, no LLM. Every launch runs through 14+ behavioral &amp; contract signals; a
          single dangerous one (honeypot, pullable LP, serial deployer, repeat offender) caps the
          composite to <strong style={{ color: tierColor.AVOID }}>AVOID</strong> no matter the momentum.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 8 }}>
          {[
            ["Honeypot + tax", "buy/sell trade simulation"],
            ["Deployer reputation", "serial-deployer + prior-token outcomes"],
            ["Repeat-offender denylist", "wallets tied to rugs we caught"],
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
          Every launch returns the per-signal <code>checks[]</code> (pass/warn/fail/unknown) + a{" "}
          <code>safetyConfidence</code> — see <em>why</em>, not just a number.
        </p>
      </div>

      {/* Track record callout */}
      <a href="/caught" style={{ textDecoration: "none", display: "block", marginTop: 40 }}>
        <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 22, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>Receipts, not promises →</div>
            <div style={{ color: C.dim, fontSize: 14, marginTop: 4 }}>
              A public, timestamped record of launches we flagged <strong style={{ color: tierColor.AVOID }}>AVOID</strong>{" "}
              that later rugged. Watch it fill.
            </div>
          </div>
          <span style={{ color: C.accent, fontSize: 14, fontWeight: 600 }}>/caught</span>
        </div>
      </a>

      <p style={{ color: C.faint, fontSize: 12, marginTop: 28 }}>
        Scores are a risk filter, not a guarantee — DYOR. Not financial advice. ·{" "}
        <a href={GH} style={link}>open source</a>
      </p>
    </main>
  );
}

const link: React.CSSProperties = { color: "#9aa0a6", textDecoration: "none" };
const btn: React.CSSProperties = { border: `1px solid ${C.line}`, color: C.text, textDecoration: "none", padding: "10px 16px", borderRadius: 10, fontSize: 14, fontWeight: 600 };
const code: React.CSSProperties = { background: C.bg, border: `1px solid ${C.line}`, borderRadius: 10, padding: 14, overflowX: "auto", fontSize: 12.5, color: C.text, lineHeight: 1.5 };

function ScoreChip({ label, value, color, sub }: { label: string; value: string; color: string; sub: string }) {
  return (
    <div style={{ flex: 1, minWidth: 170, background: C.card, border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 14px" }}>
      <div style={{ color: C.faint, fontSize: 11.5 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
      <div style={{ color: C.faint, fontSize: 11, marginTop: 1 }}>{sub}</div>
    </div>
  );
}

function Why({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: "16px 18px" }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{title}</div>
      <div style={{ color: C.dim, fontSize: 13.5, lineHeight: 1.5 }}>{children}</div>
    </div>
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
