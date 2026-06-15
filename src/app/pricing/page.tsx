import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing — RugSense",
  description: "Free verifiable track record + reports. Pay-per-call over x402 for agents (no signup). Pro for humans & teams in the works.",
  openGraph: { title: "Pricing — RugSense", description: "Free track record. Pay-per-call over x402 for agents. Pro for teams coming.", url: "https://rugsense.xyz/pricing" },
};

const C = { bg: "#0b0d12", card: "#11141b", line: "#1c212b", text: "#e6e8eb", dim: "#9aa0a6", faint: "#6b7280", accent: "#4f8cff", green: "#16c784" };
const GH = "https://github.com/0xcnr0/rugsense";

// Honest pricing surface. The real model is pay-per-call over x402 (agents). Free tier is
// the proof + human browsing. "Pro" is a genuine waitlist — NOT a fake checkout; we don't
// run subscription billing, so we say so rather than pretend.
export default function Pricing() {
  return (
    <main style={{ maxWidth: 920, margin: "0 auto", padding: "32px 20px 64px", color: C.text }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <a href="/" style={{ color: C.accent, fontSize: 13, textDecoration: "none" }}>← RugSense</a>
        <span style={{ color: C.faint, fontSize: 13 }}>pricing</span>
      </div>

      <h1 style={{ fontSize: 30, margin: "16px 0 6px" }}>Pricing</h1>
      <p style={{ color: C.dim, fontSize: 15, maxWidth: 680, marginTop: 0 }}>
        The product is sold <strong>per call over x402</strong> — your agent&apos;s wallet pays
        USDC on Base, no keys, no signup. The track record is free so you can verify the signal
        before you pay.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14, marginTop: 24 }}>
        {/* Free */}
        <Card title="Free" price="$0" tag="Humans & evaluation" accent={C.green}>
          <Feat>Live radar + per-token reports (<code>/t/…</code>)</Feat>
          <Feat>Verifiable, point-in-time track record — <code>/caught</code></Feat>
          <Feat><code>GET /api/track-record</code> · <code>GET /api/history</code> (rate-limited)</Feat>
          <Feat>Farcaster mini app (<code>/mini</code>)</Feat>
          <Cta href="/caught" label="See the track record" />
        </Card>

        {/* Pay per call */}
        <Card title="Pay-per-call" price="from $0.005" tag="Agents & developers" accent={C.accent} highlight>
          <Row k="Quick pre-screen" v="$0.005" />
          <Row k="Deep token score" v="$0.03" />
          <Row k="Scored launch feed" v="$0.03" />
          <Row k="Deployer dossier" v="$0.02" />
          <Row k="Lifecycle watch + webhook" v="$0.05" />
          <Row k="Batch (up to 20)" v="$0.10" />
          <p style={{ color: C.faint, fontSize: 12, margin: "8px 0 0" }}>x402 v2 · USDC on Base · no signup. Settles only on success.</p>
          <Cta href="/#agents" label="Add to your agent →" />
        </Card>

        {/* Pro */}
        <Card title="Pro" price="coming" tag="Teams & power users" accent={C.dim}>
          <Feat>Hosted dashboard + saved watchlists</Feat>
          <Feat>Managed alerts (email + webhook) without running infra</Feat>
          <Feat>Volume / priority pricing</Feat>
          <p style={{ color: C.faint, fontSize: 12.5, margin: "8px 0 0" }}>
            Not purchasable yet — we don&apos;t run subscription billing today. Tell us what you&apos;d
            want and we&apos;ll build it.
          </p>
          <Cta href={GH} label="Request it on GitHub" />
        </Card>
      </div>

      <p style={{ color: C.faint, fontSize: 12.5, marginTop: 26, maxWidth: 700 }}>
        Why per-call? It matches how agents actually buy — no subscription to manage, you pay only
        for the checks you run, and the free track record lets you prove the value first. See the{" "}
        <a href="/openapi.json" style={{ color: C.accent }}>OpenAPI spec</a> or{" "}
        <a href={GH} style={{ color: C.accent }}>source</a>. Not financial advice.
      </p>
    </main>
  );
}

function Card({ title, price, tag, accent, highlight, children }: { title: string; price: string; tag: string; accent: string; highlight?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${highlight ? accent : C.line}`, borderRadius: 14, padding: "18px 18px 20px", display: "flex", flexDirection: "column" }}>
      <div style={{ color: C.faint, fontSize: 12 }}>{tag}</div>
      <div style={{ fontSize: 20, fontWeight: 800, marginTop: 2 }}>{title}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: accent, margin: "4px 0 12px" }}>{price}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7, flex: 1 }}>{children}</div>
    </div>
  );
}
function Feat({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 13.5, color: C.text, lineHeight: 1.45 }}>· {children}</div>;
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, borderBottom: `1px solid ${C.bg}`, paddingBottom: 5 }}>
      <span style={{ color: C.dim }}>{k}</span>
      <span style={{ fontWeight: 700 }}>{v}</span>
    </div>
  );
}
function Cta({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} style={{ marginTop: 14, textAlign: "center", border: `1px solid ${C.line}`, color: C.text, textDecoration: "none", padding: "9px 14px", borderRadius: 10, fontSize: 13.5, fontWeight: 600 }}>
      {label}
    </a>
  );
}
