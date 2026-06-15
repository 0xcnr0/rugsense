// Generate a ready-to-post scoreboard update from the LIVE, free track-record endpoint.
// The track record markets itself once it has volume — this turns it into a weekly post.
// PRINTS only (like daily-content.ts); copy into Farcaster/X or wire an auto-poster later.
//
// Run: npx tsx scripts/scoreboard-post.ts        (override URL with RADAR_URL)

const BASE = (process.env.RADAR_URL || "https://rugsense.xyz").replace(/\/$/, "");

interface Tally { resolved: number; rugged: number; survived: number }
interface Board {
  avoid: Tally & { ruggedWithin72h: number; precisionPct: number | null; watching: number };
  safe: Tally & { cleanPct: number | null; watching: number };
  totalResolved: number;
}

(async () => {
  const res = await fetch(`${BASE}/api/track-record`, { cache: "no-store" });
  if (!res.ok) {
    console.error(`track-record fetch failed: HTTP ${res.status}`);
    process.exit(1);
  }
  const { scoreboard: b } = (await res.json()) as { scoreboard: Board };

  const date = new Date().toISOString().slice(0, 10);
  const out: string[] = [];
  out.push(`📊 RugSense scoreboard — ${date}`);
  out.push("");
  out.push("Point-in-time & leakage-free: every call snapshotted at score time, graded strictly later.");
  out.push("");

  if (b.totalResolved === 0) {
    out.push(`Still warming up — ${b.avoid.watching + b.safe.watching} verdicts under watch, none resolved yet.`);
  } else {
    if (b.avoid.precisionPct !== null)
      out.push(`🔴 AVOID precision: ${b.avoid.precisionPct}% — ${b.avoid.rugged}/${b.avoid.resolved} resolved AVOIDs rugged (${b.avoid.ruggedWithin72h} within 72h).`);
    if (b.safe.cleanPct !== null)
      out.push(`🟢 HOT/WATCH stayed clean: ${b.safe.cleanPct}% — ${b.safe.survived}/${b.safe.resolved} survived.`);
    out.push(`Total verdicts resolved to date: ${b.totalResolved}.`);
  }
  out.push("");
  out.push(`Verify it yourself (free): ${BASE}/api/track-record · ${BASE}/api/history`);
  out.push("#Base #x402 #rugcheck");

  const text = out.join("\n");
  console.log(text);
  console.log("\n— — —");
  console.log(`(chars: ${text.length}; trim for X's 280 if needed — Farcaster allows longer)`);
})();
