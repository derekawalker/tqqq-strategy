import { schwabFetch } from "./client";

interface AccountNumber {
  accountNumber: string;
  hashValue: string;
}

/** Returns a map of accountNumber → hashValue */
export async function getAccountHashes(): Promise<Record<string, string>> {
  const res = await schwabFetch("/trader/v1/accounts/accountNumbers");
  if (!res.ok) throw new Error(`Failed to fetch account numbers: ${res.status}`);
  const data = (await res.json()) as AccountNumber[];
  return Object.fromEntries(data.map((a) => [a.accountNumber, a.hashValue]));
}
