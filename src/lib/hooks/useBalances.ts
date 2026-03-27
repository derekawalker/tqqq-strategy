"use client";

import { useApp } from "@/lib/context/AppContext";

export function useBalances() {
  const { activeAccount, balances, balancesLoading } = useApp();

  const balance = activeAccount
    ? balances.find((b) => b.accountNumber === activeAccount.accountNumber) ?? null
    : null;

  return { balance, loading: balancesLoading };
}
