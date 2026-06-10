import { type Address, type Abi, toFunctionSelector } from "viem";
import { publicClient } from "./client";
import type { DexPair, Flag } from "./types";

// Onchain contract checks (free: public Base RPC only). Two cheap, high-signal
// reads that the orchestrator (assess.ts) combines with honeypot.is + holder/LP
// analysis:
//   1. Bytecode selector scan — does the token expose dangerous functions?
//   2. Ownership — is control renounced, or can an owner still act?
// Heuristic, not a guarantee (selectors can false-positive); one input to the composite.

const DEAD = "0x000000000000000000000000000000000000dEaD".toLowerCase();
const ZERO = "0x0000000000000000000000000000000000000000";

// 4-byte function selectors (keccak256(sig)[:4]) of risky entry points.
const DANGER_SELECTORS: { code: string; label: string; severity: Flag["severity"]; selectors: string[] }[] = [
  { code: "MINTABLE", label: "Exposes mint() — supply can be inflated", severity: "danger", selectors: ["40c10f19", "a0712d68"] },
  { code: "BLACKLIST", label: "Has blacklist machinery", severity: "warn", selectors: ["f9f92be4", "fe575a87", "1d6dca6f"] },
  { code: "PAUSABLE", label: "Transfers can be paused", severity: "warn", selectors: ["8456cb59"] },
];

// Owner-mutable TRADE-CONTROL levers (#6). A live honeypot.is sim only reflects the
// CURRENT contract state — it can't see a concealed lever the owner flips AFTER buyers
// pile in (disable sells, set max-tx to dust, raise tax to 100%). Detecting these
// switches at the bytecode level catches the latent honeypot that selector-presence
// of mint/blacklist alone misses (MDPI 2025/1/450). The risk is real only while the
// owner can still call them — so the verdict is gated on ownership renouncement below.
// Selectors are derived from signatures (no hand-typed 4-bytes → no transcription bugs).
const MUTABLE_CONTROL_SIGS = [
  "enableTrading()",
  "setSwapEnabled(bool)",
  "setTradingEnabled(bool)",
  "setTrading(bool)",
  "setMaxTxAmount(uint256)",
  "setMaxWallet(uint256)",
  "setMaxWalletAmount(uint256)",
  "removeLimits()",
  "setFee(uint256)",
  "setFees(uint256,uint256)",
  "setTaxFee(uint256)",
  "setBuyFee(uint256)",
  "setSellFee(uint256)",
  "updateFees(uint256,uint256)",
] as const;
const MUTABLE_CONTROL_SELECTORS = MUTABLE_CONTROL_SIGS.map((s) => toFunctionSelector(s).slice(2).toLowerCase());

const ERC20_OWNER_ABI = [
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const satisfies Abi;

export interface OnchainSafety {
  ok: boolean; // did any check actually run?
  scoreDelta: number; // adjustment to apply to the heuristic safety score
  flags: Flag[];
  details: {
    ownershipRenounced: boolean | null;
    mintable: boolean | null;
    blacklist: boolean | null;
    pausable: boolean | null;
    /** Owner-mutable trade-control levers present in bytecode (latent honeypot). */
    mutableTradeControls: boolean | null;
  };
}

// Small in-memory cache: safety attributes change rarely, RPC calls cost latency.
const cache = new Map<string, { at: number; value: OnchainSafety }>();
const TTL_MS = 10 * 60_000;

export async function getOnchainSafety(pair: DexPair, now: number = Date.now()): Promise<OnchainSafety> {
  const token = pair.baseToken.address as Address;
  const key = token.toLowerCase();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.value;

  const value = await compute(pair, token);
  cache.set(key, { at: now, value });
  return value;
}

async function compute(pair: DexPair, token: Address): Promise<OnchainSafety> {
  const flags: Flag[] = [];
  let scoreDelta = 0;
  const details: OnchainSafety["details"] = {
    ownershipRenounced: null,
    mintable: null,
    blacklist: null,
    pausable: null,
    mutableTradeControls: null,
  };

  // 1) Bytecode selector scan.
  let ranAnything = false;
  try {
    const code = await publicClient.getCode({ address: token });
    if (code && code.length > 2) {
      ranAnything = true;
      const hex = code.toLowerCase();
      for (const d of DANGER_SELECTORS) {
        const present = d.selectors.some((s) => hex.includes(s));
        if (d.code === "MINTABLE") details.mintable = present;
        if (d.code === "BLACKLIST") details.blacklist = present;
        if (d.code === "PAUSABLE") details.pausable = present;
        if (present) {
          flags.push({ code: d.code, label: d.label, severity: d.severity });
          scoreDelta += d.severity === "danger" ? -25 : -11;
        }
      }
      // Latent honeypot: owner-mutable trade controls (scored after ownership below).
      details.mutableTradeControls = MUTABLE_CONTROL_SELECTORS.some((s) => hex.includes(s));
    }
  } catch {
    /* RPC hiccup — leave selector details null */
  }

  // 2) Ownership: renounced (owner = 0x0/dead) is safer; an active owner can act.
  //    (LP burn/lock is handled separately by holders.ts via log reconstruction.)
  try {
    const owner = await publicClient.readContract({
      address: token,
      abi: ERC20_OWNER_ABI,
      functionName: "owner",
    });
    ranAnything = true;
    const o = String(owner).toLowerCase();
    const renounced = o === ZERO || o === DEAD;
    details.ownershipRenounced = renounced;
    if (renounced) {
      flags.push({ code: "OWNERSHIP_RENOUNCED", label: "Ownership renounced", severity: "info" });
      scoreDelta += 12;
    } else {
      flags.push({ code: "OWNER_ACTIVE", label: "Owner can still act on the contract", severity: "warn" });
      scoreDelta -= 8;
    }
  } catch {
    /* no owner() / non-standard — leave ownershipRenounced null */
  }

  // Latent-honeypot verdict (gated on ownership — see latentHoneypotSignal).
  const lat = latentHoneypotSignal(details.mutableTradeControls, details.ownershipRenounced);
  scoreDelta += lat.scoreDelta;
  if (lat.flag) flags.push(lat.flag);

  return { ok: ranAnything, scoreDelta, flags, details };
}

/**
 * Score owner-mutable trade controls (#6), gated on ownership. The levers only
 * matter while the owner can still pull them: renounced ⇒ inert; active owner ⇒
 * the contract can turn into a honeypot post-launch even if it sells fine now;
 * unknown ownership ⇒ a softer warning.
 */
export function latentHoneypotSignal(
  mutableControls: boolean | null,
  ownershipRenounced: boolean | null,
): { scoreDelta: number; flag: Flag | null } {
  if (mutableControls !== true) return { scoreDelta: 0, flag: null };
  if (ownershipRenounced === true) {
    return { scoreDelta: 0, flag: { code: "TRADE_CONTROLS_INERT", label: "Trade-control levers present but ownership renounced", severity: "info" } };
  }
  const known = ownershipRenounced === false;
  return {
    scoreDelta: known ? -12 : -6,
    flag: {
      code: "MUTABLE_TRADE_CONTROLS",
      label: known
        ? "Owner can disable sells / raise tax post-launch (latent honeypot)"
        : "Mutable trade controls present (ownership unconfirmed)",
      severity: "warn",
    },
  };
}
