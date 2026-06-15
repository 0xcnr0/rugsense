// Calibration analysis — turn the leakage-free resolved-outcome log into evidence for
// tuning the scoring thresholds (src/lib/scoring.ts CFG). Pulls the free /api/history,
// then reports precision by verdict, predictiveness per flag, and time-to-rug — so we
// recalibrate from data, NOT vibes. PRINTS a report; changes nothing.
//
// Run: npx tsx scripts/calibrate.ts        (override host with RADAR_URL)
//
// IMPORTANT: don't tune on a handful of points. The report tags confidence by sample
// size; treat any signal with n < ~30 as anecdotal, not actionable.

export {}; // make this a module (isolates top-level consts from other scripts)

const BASE = (process.env.RADAR_URL || "https://rugsense.xyz").replace(/\/$/, "");
const MIN_N = 30; // below this, per-bucket rates are anecdotal

interface Row {
  verdict: "AVOID" | "WATCH" | "HOT";
  topFlag: string;
  outcome: "rugged" | "survived";
  hoursToResolve: number;
  liqAtScore: number;
}

function pct(n: number, d: number): string {
  return d > 0 ? `${Math.round((n / d) * 100)}%` : "—";
}
function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

(async () => {
  const res = await fetch(`${BASE}/api/history?limit=200`, { cache: "no-store" });
  if (!res.ok) { console.error(`history fetch failed: HTTP ${res.status}`); process.exit(1); }
  const { history } = (await res.json()) as { history: Row[] };

  console.log(`Calibration report — ${BASE} — ${history.length} resolved verdicts\n`);
  if (history.length < MIN_N) {
    console.log(`⚠️  Only ${history.length} resolved (< ${MIN_N}). Everything below is ANECDOTAL — do NOT`);
    console.log(`   retune scoring.ts CFG yet. Let the cron accrue more, then re-run.\n`);
  }

  // Precision by verdict.
  const byVerdict: Record<string, { n: number; rug: number }> = {};
  const byFlag: Record<string, { n: number; rug: number }> = {};
  const rugHours: number[] = [];
  for (const r of history) {
    (byVerdict[r.verdict] ??= { n: 0, rug: 0 });
    byVerdict[r.verdict]!.n++;
    if (r.outcome === "rugged") byVerdict[r.verdict]!.rug++;
    const f = r.topFlag || "(none)";
    (byFlag[f] ??= { n: 0, rug: 0 });
    byFlag[f]!.n++;
    if (r.outcome === "rugged") { byFlag[f]!.rug++; rugHours.push(r.hoursToResolve); }
  }

  console.log("By verdict (rug rate = share that rugged):");
  for (const v of ["AVOID", "WATCH", "HOT"]) {
    const b = byVerdict[v] ?? { n: 0, rug: 0 };
    const want = v === "AVOID" ? "HIGH is good (we said avoid)" : "LOW is good (we said tradeable)";
    console.log(`  ${v.padEnd(6)} n=${String(b.n).padStart(3)}  rug=${pct(b.rug, b.n).padStart(4)}   ${want}`);
  }

  console.log("\nBy top flag (which flags actually predict a rug):");
  Object.entries(byFlag).sort((a, b) => b[1].n - a[1].n).forEach(([f, b]) => {
    const tag = b.n < MIN_N ? " (anecdotal)" : "";
    console.log(`  ${f.padEnd(20)} n=${String(b.n).padStart(3)}  rug=${pct(b.rug, b.n).padStart(4)}${tag}`);
  });

  console.log(`\nTime-to-rug (rugged only): median ${median(rugHours)}h, n=${rugHours.length}`);
  console.log("\nHow to act: when a verdict's rug rate contradicts its meaning at n≥30 (e.g. WATCH");
  console.log("rugging as often as AVOID), tighten the relevant CFG threshold in src/lib/scoring.ts.");
})();
