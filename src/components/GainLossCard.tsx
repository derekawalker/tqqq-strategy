"use client";

import { useMemo } from "react";
import { Paper, Text, Stack } from "@mantine/core";
import { Outfit } from "next/font/google";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/context/AppContext";
import { useCardBg } from "@/lib/hooks/useCardBg";

const outfit = Outfit({ subsets: ["latin"] });

function fmtMoney(n: number) {
  const prefix = n < 0 ? "-$" : "$";
  return `${prefix}${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function GainLossCard() {
  const { filledOrders, activeAccount, privacyMode, snapshotLoading } = useApp();
  const mask = (v: string) => (privacyMode ? "••••" : v);

  const { totalGain, totalGainPct, annualROI } = useMemo(() => {
    const startingCash = activeAccount?.settings.startingCash ?? null;
    const startingDate = activeAccount?.settings.startingDate ?? null;

    const sells = filledOrders
      .filter((o) => o.side === "SELL")
      .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    const availableBuys = filledOrders
      .filter((o) => o.side === "BUY")
      .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    const usedBuyIds = new Set<number>();

    let totalGain = 0;
    for (const sell of sells) {
      const sellTime = new Date(sell.time).getTime();
      const matchingBuy = [...availableBuys]
        .reverse()
        .find((b) => !usedBuyIds.has(b.orderId) && b.shares === sell.shares && new Date(b.time).getTime() < sellTime)
        ?? null;
      if (matchingBuy) usedBuyIds.add(matchingBuy.orderId);
      const buyPrice = matchingBuy?.fillPrice ?? null;
      if (buyPrice != null) totalGain += (sell.fillPrice - buyPrice) * sell.shares;
    }

    const totalGainPct = startingCash && startingCash > 0 ? (totalGain / startingCash) * 100 : null;

    let annualROI: number | null = null;
    if (totalGainPct != null && startingDate) {
      const daysInStrategy = Math.max(1, (Date.now() - new Date(startingDate).getTime()) / 86400000);
      annualROI = (totalGainPct / daysInStrategy) * 365;
    }

    return { totalGain, totalGainPct, annualROI };
  }, [filledOrders, activeAccount]);

  const gainColor = totalGain >= 0 ? "light-dark(var(--mantine-color-dark-9), white)" : "var(--mantine-color-red-6)";
  const bg = useCardBg(activeAccount?.color ?? "dark");
  const router = useRouter();

  return (
    <Paper p="md" radius="md" withBorder onClick={() => router.push("/profit-tracker")} style={{ gridColumn: "span 3", background: bg, cursor: "pointer" }}>
      <Stack gap="md" align="center">
        <Text size="xs" c="dimmed" tt="uppercase" fw={600} lts={0.5}>Gain / Loss</Text>
        <Text
          fw={700}
          lh={1}
          className={outfit.className}
          style={{ fontSize: "2.75rem", color: gainColor }}
        >
          {snapshotLoading ? "—" : mask(fmtMoney(totalGain))}
        </Text>
        {(totalGainPct != null || annualROI != null) && (
          <Text size="sm" c="dimmed">
            {totalGainPct != null && (
              <Text span fw={500}>
                Total Gain: {totalGain >= 0 ? "+" : ""}{totalGainPct.toFixed(1)}%
              </Text>
            )}
            {totalGainPct != null && annualROI != null && (
              <Text span> · </Text>
            )}
            {annualROI != null && (
              <Text span fw={500}>
                Annual ROI: {annualROI >= 0 ? "+" : ""}{annualROI.toFixed(1)}%
              </Text>
            )}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}
