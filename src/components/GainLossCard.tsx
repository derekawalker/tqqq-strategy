"use client";

import { useMemo } from "react";
import { Paper, Text, Stack } from "@mantine/core";
import { Outfit } from "next/font/google";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/context/AppContext";
import { useCardBg } from "@/lib/hooks/useCardBg";
import { CARD_RADIUS, CARD_LABEL_STYLE } from "@/lib/cardStyles";
import { useBalances } from "@/lib/hooks/useBalances";
import { AnimatedNumber } from "@/components/AnimatedNumber";

const outfit = Outfit({ subsets: ["latin"] });

function fmtMoney(n: number) {
  const prefix = n < 0 ? "-$" : "$";
  return `${prefix}${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function GainLossCard() {
  const { activeAccount, privacyMode, snapshotLoading } = useApp();
  const { balance, loading: balanceLoading } = useBalances();
  const mask = (v: string) => (privacyMode ? "••••" : v);

  const { totalGain, totalGainPct, annualROI } = useMemo(() => {
    const startingCash = activeAccount?.settings.startingCash ?? null;
    const startingDate = activeAccount?.settings.startingDate ?? null;
    const currentValue = balance?.totalValue ?? null;

    if (startingCash == null || currentValue == null) {
      return { totalGain: null, totalGainPct: null, annualROI: null };
    }

    const totalGain = currentValue - startingCash;
    const totalGainPct = startingCash > 0 ? (totalGain / startingCash) * 100 : null;

    let annualROI: number | null = null;
    if (totalGainPct != null && startingDate) {
      const daysInStrategy = Math.max(1, (Date.now() - new Date(startingDate).getTime()) / 86400000);
      annualROI = (totalGainPct / daysInStrategy) * 365;
    }

    return { totalGain, totalGainPct, annualROI };
  }, [balance, activeAccount]);

  const gainColor = (totalGain ?? 0) >= 0 ? "white" : "var(--mantine-color-red-6)";
  const bg = useCardBg(activeAccount?.color ?? "dark");
  const router = useRouter();

  return (
    <Paper p="md" radius={CARD_RADIUS} onClick={() => router.push("/profit-tracker")} style={{ background: bg, cursor: "pointer", height: "100%" }}>
      <Stack gap="md" align="center">
        <Text c="dimmed" tt="uppercase" fw={600} style={CARD_LABEL_STYLE}>Gain / Loss</Text>
        <Text
          component="div"
        >
          <AnimatedNumber
            value={snapshotLoading || balanceLoading || totalGain == null ? "—" : mask(fmtMoney(totalGain))}
            className={outfit.className}
            style={{ fontSize: "2.75rem", fontWeight: 700, lineHeight: 1, color: gainColor }}
          />
        </Text>
        {(totalGainPct != null || annualROI != null) && (
          <Text size="sm" c="dimmed">
            {totalGainPct != null && (
              <Text span fw={500}>
                Total Gain: {(totalGain ?? 0) >= 0 ? "+" : ""}{totalGainPct.toFixed(1)}%
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
