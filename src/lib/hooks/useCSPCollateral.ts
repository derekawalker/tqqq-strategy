import { useMemo } from "react";
import { useApp } from "@/lib/context/AppContext";

/** Total collateral held for open cash-secured puts. Returns null if no puts are open. */
export function useCSPCollateral(): number | null {
  const { optionPositions } = useApp();

  return useMemo(() => {
    const puts = optionPositions.filter((p) => p.putCall === "PUT" && p.shortQty > 0);
    if (puts.length === 0) return null;
    return puts.reduce((sum, p) => sum + p.strike * 100 * p.shortQty, 0);
  }, [optionPositions]);
}
