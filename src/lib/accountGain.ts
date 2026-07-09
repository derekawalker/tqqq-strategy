import type { Transaction } from "@/app/api/schwab/data/route";

export interface AccountGain {
  totalGain: number | null;
  totalGainPct: number | null;
  annualROI: number | null;
  /** Deposits minus withdrawals since startingDate (0 when none found). */
  netTransfers: number;
  /** Total deposits since startingDate — the part that grows the invested basis. */
  deposits: number;
}

/**
 * Total gain adjusted for external cash flows: deposits aren't gains and
 * withdrawals aren't losses. The percent return is measured against invested
 * capital (initial cash + deposits); withdrawals don't shrink the basis that
 * generated the gains.
 */
export function computeAccountGain(opts: {
  initialCash: number | null;
  startingDate: Date | null;
  currentValue: number | null;
  transactions: Transaction[];
  accountNumber: string | null;
  now: number;
}): AccountGain {
  const { initialCash, startingDate, currentValue, transactions, accountNumber, now } = opts;

  let deposits = 0;
  let withdrawals = 0;
  for (const t of transactions) {
    if (t.category !== "transfer") continue;
    if (accountNumber != null && t.accountNumber !== accountNumber) continue;
    if (startingDate && new Date(t.time) < startingDate) continue;
    if (t.amount > 0) deposits += t.amount;
    else withdrawals += -t.amount;
  }
  const netTransfers = deposits - withdrawals;

  if (initialCash == null || currentValue == null) {
    return { totalGain: null, totalGainPct: null, annualROI: null, netTransfers, deposits };
  }

  const totalGain = currentValue - initialCash - netTransfers;
  const basis = initialCash + deposits;
  const totalGainPct = basis > 0 ? (totalGain / basis) * 100 : null;

  let annualROI: number | null = null;
  if (totalGainPct != null && startingDate) {
    const daysInStrategy = Math.max(1, (now - startingDate.getTime()) / 86400000);
    annualROI = (totalGainPct / daysInStrategy) * 365;
  }

  return { totalGain, totalGainPct, annualROI, netTransfers, deposits };
}
