// Shared low-level Etherscan V2 client (chainid 8453 = Base). A single FREE key
// powers every Etherscan-backed signal (deployer reputation, funding-source
// cluster). Free tier is 5 req/s, so calls are serialized with a min spacing.
// Without a key, every dependent signal degrades to "unknown" (no score impact).

const ETHERSCAN_V2 = "https://api.etherscan.io/v2/api";
const BASE_CHAIN_ID = 8453;

function apiKey(): string | undefined {
  return process.env.ETHERSCAN_API_KEY || process.env.BASESCAN_API_KEY || undefined;
}

/** Is any Etherscan-backed signal configured? (V2 free key present.) */
export function etherscanConfigured(): boolean {
  return !!apiKey();
}

// Etherscan V2 free tier is 5 req/s. Serialize calls with a min spacing so a
// concurrent feed batch doesn't burst past the limit and degrade to rate-limit
// errors. ~210ms ≈ <5/s with headroom.
const MIN_SPACING_MS = 210;
let chain: Promise<void> = Promise.resolve();
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
function throttle<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn);
  chain = run.then(
    () => sleep(MIN_SPACING_MS),
    () => sleep(MIN_SPACING_MS),
  );
  return run;
}

interface EtherscanResponse<T> {
  status: string; // "1" ok, "0" no-result/error
  message: string;
  result: T;
}

/** Call the Etherscan V2 API. null when unconfigured, throttled, or on error. */
export async function etherscan<T>(params: Record<string, string>): Promise<T | null> {
  const key = apiKey();
  if (!key) return null;
  const qs = new URLSearchParams({ chainid: String(BASE_CHAIN_ID), apikey: key, ...params });
  try {
    const res = await throttle(() =>
      fetch(`${ETHERSCAN_V2}?${qs}`, { headers: { accept: "application/json" }, cache: "no-store" }),
    );
    if (!res.ok) return null;
    const j = (await res.json()) as EtherscanResponse<T>;
    // status "0" with an empty array is a valid "no transactions" answer; status
    // "0" with a string message is an error/throttle → null (unknown).
    if (j.status === "1") return j.result;
    if (Array.isArray(j.result)) return j.result as T;
    return null;
  } catch {
    return null;
  }
}

export interface TxRecord {
  to: string;
  from: string;
  value: string;
  timeStamp: string;
  contractAddress: string;
  isError?: string;
}

/** Account transaction list (normal txs). null = unknown. */
export async function txlist(
  address: string,
  sort: "asc" | "desc",
  offset: number,
): Promise<TxRecord[] | null> {
  return etherscan<TxRecord[]>({
    module: "account",
    action: "txlist",
    address,
    startblock: "0",
    endblock: "99999999",
    page: "1",
    offset: String(offset),
    sort,
  });
}
