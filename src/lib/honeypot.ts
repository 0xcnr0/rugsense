import type { Flag } from "./types";

// honeypot.is integration (free, Base = chainID 8453). One call gives us, via real
// buy/sell trade simulation, several of the canonical safety signals that are hard
// to do reliably ourselves: honeypot verdict, buy/sell tax, source-verified, proxy.
// We keep this as ONE input to our composite — if it's down/rate-limited we degrade
// to our own RPC signals (mint/owner/LP) and lower confidence.

const BASE_CHAIN_ID = 8453;
const ENDPOINT = "https://api.honeypot.is/v2/IsHoneypot";

export interface HoneypotInfo {
  ok: boolean; // did the API return usable data?
  isHoneypot: boolean | null;
  simulationSuccess: boolean | null;
  buyTax: number | null;
  sellTax: number | null;
  openSource: boolean | null; // contract source verified
  isProxy: boolean | null; // upgradeable / proxy calls
  riskLevel: number | null; // honeypot.is own summary (cross-check only)
  apiFlags: string[];
}

const cache = new Map<string, { at: number; value: HoneypotInfo }>();
const TTL_MS = 10 * 60_000;

const EMPTY: HoneypotInfo = {
  ok: false,
  isHoneypot: null,
  simulationSuccess: null,
  buyTax: null,
  sellTax: null,
  openSource: null,
  isProxy: null,
  riskLevel: null,
  apiFlags: [],
};

export async function getHoneypotInfo(token: string, now: number = Date.now()): Promise<HoneypotInfo> {
  const key = token.toLowerCase();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.value;

  let value = EMPTY;
  try {
    const res = await fetch(`${ENDPOINT}?address=${token}&chainID=${BASE_CHAIN_ID}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (res.ok) {
      const j = (await res.json()) as HoneypotApiResponse;
      value = {
        ok: true,
        isHoneypot: j.honeypotResult?.isHoneypot ?? null,
        simulationSuccess: j.simulationSuccess ?? null,
        buyTax: j.simulationResult?.buyTax ?? null,
        sellTax: j.simulationResult?.sellTax ?? null,
        openSource: j.contractCode?.openSource ?? null,
        isProxy: (j.contractCode?.isProxy || j.contractCode?.hasProxyCalls) ?? null,
        riskLevel: j.summary?.riskLevel ?? null,
        apiFlags: Array.isArray(j.flags) ? j.flags.map(String) : [],
      };
    }
  } catch {
    /* API down / rate-limited → degrade gracefully to EMPTY (ok:false) */
  }

  cache.set(key, { at: now, value });
  return value;
}

/** Translate honeypot.is data into score adjustments + flags. */
export function honeypotSignals(h: HoneypotInfo): { scoreDelta: number; flags: Flag[] } {
  const flags: Flag[] = [];
  let scoreDelta = 0;
  if (!h.ok) return { scoreDelta, flags };

  if (h.isHoneypot === true) {
    flags.push({ code: "HONEYPOT", label: "Honeypot: sells blocked (sim)", severity: "danger" });
    scoreDelta -= 70; // forces AVOID
  } else if (h.simulationSuccess === true) {
    flags.push({ code: "SELLABLE", label: "Sell simulation passed", severity: "info" });
    scoreDelta += 8;
  }

  const sell = h.sellTax ?? 0;
  const buy = h.buyTax ?? 0;
  if (sell >= 50 || buy >= 50) {
    flags.push({ code: "EXTREME_TAX", label: `Extreme tax (buy ${buy}% / sell ${sell}%)`, severity: "danger" });
    scoreDelta -= 40;
  } else if (sell > 10 || buy > 10) {
    flags.push({ code: "HIGH_TAX", label: `High tax (buy ${buy}% / sell ${sell}%)`, severity: "warn" });
    scoreDelta -= 18;
  }

  if (h.openSource === false) {
    flags.push({ code: "UNVERIFIED", label: "Contract source not verified", severity: "warn" });
    scoreDelta -= 12;
  }
  if (h.isProxy === true) {
    flags.push({ code: "UPGRADEABLE", label: "Proxy/upgradeable — logic can change", severity: "warn" });
    scoreDelta -= 12;
  }

  return { scoreDelta, flags };
}

interface HoneypotApiResponse {
  simulationSuccess?: boolean;
  honeypotResult?: { isHoneypot?: boolean };
  simulationResult?: { buyTax?: number; sellTax?: number; transferTax?: number };
  contractCode?: { openSource?: boolean; rootOpenSource?: boolean; isProxy?: boolean; hasProxyCalls?: boolean };
  summary?: { risk?: string; riskLevel?: number };
  flags?: unknown[];
}
