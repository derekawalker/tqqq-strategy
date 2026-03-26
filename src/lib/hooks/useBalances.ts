"use client";

import { useState, useEffect } from "react";
import { useApp } from "@/lib/context/AppContext";
import type { AccountBalance } from "@/app/api/schwab/balances/route";

export function useBalances() {
  const { activeAccount, refreshTick } = useApp();
  const [balances, setBalances] = useState<AccountBalance[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch("/api/schwab/balances");
        if (!res.ok) return;
        const data: AccountBalance[] = await res.json();
        if (!cancelled) setBalances(data);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [refreshTick]);

  const balance = activeAccount
    ? balances.find((b) => b.accountNumber === activeAccount.accountNumber) ?? null
    : null;

  return { balance, loading };
}
