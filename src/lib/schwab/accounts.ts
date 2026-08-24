import { schwabFetch } from "./client";

interface AccountNumber {
  accountNumber: string;
  hashValue: string;
}

// The account→hash mapping is fixed for the life of an account, but every data
// route call re-fetched it. Hold it for an hour so it costs one request per
// warm instance instead of one per refresh.
const HASH_TTL_MS = 60 * 60 * 1000;
let cachedHashes: Record<string, string> | null = null;
let cachedHashesAt = 0;

/** Returns a map of accountNumber → hashValue */
export async function getAccountHashes(): Promise<Record<string, string>> {
  if (cachedHashes && Date.now() - cachedHashesAt < HASH_TTL_MS) return cachedHashes;

  const res = await schwabFetch("/trader/v1/accounts/accountNumbers");
  if (!res.ok) throw new Error(`Failed to fetch account numbers: ${res.status}`);
  const data = (await res.json()) as AccountNumber[];
  const hashes = Object.fromEntries(data.map((a) => [a.accountNumber, a.hashValue]));
  cachedHashes = hashes;
  cachedHashesAt = Date.now();
  return hashes;
}
