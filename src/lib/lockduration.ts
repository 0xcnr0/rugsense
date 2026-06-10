import { type Address, type Abi } from "viem";
import { publicClient } from "./client";

// ─────────────────────────────────────────────────────────────────────────────
// Liquidity-lock DURATION (#4). "LP locked: yes/no" is not enough — a lock that
// expires in 3 days is nearly as exit-scammable as no lock, while a permanent
// (burned / no-withdraw) lock is the real safety signal. We classify HOW DURABLE
// a secured lock is and, for time-locks, read the remaining duration.
//
//   permanent  — burned, or held by a no-withdraw locker (Clanker Lp lockers,
//                dead/zero address). Full credit. This is what our verified
//                allowlists currently resolve to.
//   timed      — held by a time-locker that exposes an unlock timestamp. Credit
//                scales with remaining duration; a soon-to-unlock lock is flagged.
//   none       — not provably secured (handled by the caller as unverified).
//
// Time-lockers (UNCX / Team.Finance / PinkLock style) differ per contract, so
// their unlock readers live in an extensible registry — add VERIFIED Base locker
// addresses + their unlock ABI only (same "verified-only" rule as the allowlists).
// Empty registry ⇒ behaves exactly as before for today's permanent lockers.
// ─────────────────────────────────────────────────────────────────────────────

export type LockType = "permanent" | "timed" | "none";

export interface LockDuration {
  type: LockType;
  /** Days until the lock can be pulled; null for permanent/unknown. */
  unlocksInDays: number | null;
  label: string;
}

export const PERMANENT: LockDuration = { type: "permanent", unlocksInDays: null, label: "permanent" };
export const NO_LOCK: LockDuration = { type: "none", unlocksInDays: null, label: "no lock" };

/** A registered time-locker: read the unlock timestamp (unix seconds) for a holder. */
type UnlockReader = (locker: Address, holder: Address) => Promise<number | null>;

// VERIFIED time-lockers on Base only. Example wiring (commented until an address is
// confirmed on-chain): UNCX-style lockers expose a per-lock unlock timestamp.
const TIMELOCK_RESOLVERS: ReadonlyMap<string, UnlockReader> = new Map<string, UnlockReader>([
  // ["0x<verified-uncx-base-locker>", uncxUnlockReader],
]);

const _UNCX_LIKE_ABI = [
  { type: "function", name: "getLocksForToken", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const satisfies Abi;
void _UNCX_LIKE_ABI; // referenced by future registered resolvers

/** Is this secured-holder a registered TIME locker (vs a permanent one)? */
export function isTimeLocker(addr: string): boolean {
  return TIMELOCK_RESOLVERS.has(addr.toLowerCase());
}

/**
 * Resolve a secured lock's durability. `secured` callers pass the holder that
 * provably secures the LP (burn address, or a known locker). Burns and
 * no-withdraw lockers are permanent; a registered time-locker is read for its
 * remaining duration. Anything else → permanent by caller contract (only verified
 * holders reach here).
 */
export async function getLockDuration(
  holder: string,
  lpToken: Address,
  now: number = Date.now(),
): Promise<LockDuration> {
  const h = holder.toLowerCase();
  const reader = TIMELOCK_RESOLVERS.get(h);
  if (!reader) return PERMANENT; // burn / no-withdraw locker
  try {
    const unlockSec = await reader(h as Address, lpToken);
    if (unlockSec == null) return PERMANENT; // couldn't read → treat as the verified-locker default
    const unlocksInDays = (unlockSec * 1000 - now) / 86_400_000;
    return {
      type: "timed",
      unlocksInDays: Math.max(0, unlocksInDays),
      label: unlocksInDays <= 0 ? "expired" : `unlocks in ${Math.round(unlocksInDays)}d`,
    };
  } catch {
    return PERMANENT;
  }
}

/**
 * Score adjustment for a TIMED lock's remaining duration. Permanent locks keep the
 * caller's full credit (delta 0 here). A short remaining lock claws some back and
 * flags it; a long one is left at full credit.
 */
export function durationSignal(d: LockDuration): { scoreDelta: number; flag: string | null; detail: string } {
  if (d.type !== "timed" || d.unlocksInDays == null) {
    return { scoreDelta: 0, flag: null, detail: d.label };
  }
  if (d.unlocksInDays < 7) {
    return { scoreDelta: -12, flag: "LP_UNLOCKS_SOON", detail: `LP unlocks in ${Math.round(d.unlocksInDays)}d` };
  }
  if (d.unlocksInDays < 30) {
    return { scoreDelta: -6, flag: "LP_SHORT_LOCK", detail: `LP unlocks in ${Math.round(d.unlocksInDays)}d` };
  }
  return { scoreDelta: 0, flag: null, detail: `LP locked ${Math.round(d.unlocksInDays)}d` };
}
