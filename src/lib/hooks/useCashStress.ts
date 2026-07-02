import { useMemo } from "react";
import { useApp } from "@/lib/context/AppContext";
import { useLevels } from "@/lib/hooks/useLevels";
import { computeCashStress, worstShortfall, type CashStressPoint } from "@/lib/cashStress";

export interface CashStressSummary {
  points: CashStressPoint[];
  worst: CashStressPoint | null;
  cashAvailable: number;
  currentPrice: number;
}

/** Cash double-commitment stress sweep for the active account. */
export function useCashStress(): CashStressSummary | null {
  const { activeAccount, balances, optionPositions, quote } = useApp();
  const levelsSummary = useLevels();

  const balance = activeAccount
    ? balances.find((b) => b.accountNumber === activeAccount.accountNumber) ?? null
    : null;

  return useMemo(() => {
    if (!levelsSummary || !balance || quote.price <= 0) return null;

    const ownedLevelIndices = new Set(levelsSummary.ownedLevels.map((l) => l.n));
    const shortPuts = optionPositions
      .filter((p) => p.putCall === "PUT" && p.shortQty > 0 && p.underlyingSymbol === "TQQQ")
      .map((p) => ({ strike: p.strike, shortQty: p.shortQty }));

    const points = computeCashStress({
      levels: levelsSummary.levels,
      ownedLevelIndices,
      shortPuts,
      currentPrice: quote.price,
      cashAvailable: balance.cashAvailableForTrading,
    });

    return {
      points,
      worst: worstShortfall(points),
      cashAvailable: balance.cashAvailableForTrading,
      currentPrice: quote.price,
    };
  }, [levelsSummary, balance, optionPositions, quote.price]);
}
