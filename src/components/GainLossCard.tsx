"use client";

import { useMemo, useState } from "react";
import { Paper, Text, Stack, Tooltip, Group, Skeleton } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { Outfit } from "next/font/google";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/context/AppContext";
import { createMask } from "@/lib/format";
import { useAccountColor } from "@/lib/hooks/useAccountColor";
import { useCardBg } from "@/lib/hooks/useCardBg";
import { CARD_RADIUS, CARD_LABEL_STYLE } from "@/lib/cardStyles";
import { useBalances } from "@/lib/hooks/useBalances";
import { computeAccountGain } from "@/lib/accountGain";
import { AnimatedNumber } from "@/components/AnimatedNumber";

const outfit = Outfit({ subsets: ["latin"] });

function fmtMoney(n: number) {
  const prefix = n < 0 ? "-$" : "$";
  return `${prefix}${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function GainLossCard() {
  const { activeAccount, privacyMode, snapshotLoading, transactions } = useApp();
  const accountColor = useAccountColor("dark");
  const { balance, loading: balanceLoading } = useBalances();
  const mask = createMask(privacyMode);
  const [now] = useState(() => Date.now());

  const { totalGain, totalGainPct, annualROI } = useMemo(
    () =>
      computeAccountGain({
        initialCash: activeAccount?.settings.initialCash ?? null,
        startingDate: activeAccount?.settings.startingDate ?? null,
        currentValue: balance?.totalValue ?? null,
        transactions,
        accountNumber: activeAccount?.accountNumber ?? null,
        now,
      }),
    [balance, activeAccount, transactions, now],
  );

  const gainColor = (totalGain ?? 0) >= 0 ? "white" : "var(--mantine-color-red-6)";
  const bg = useCardBg(accountColor);
  const router = useRouter();

  return (
    <Paper p="md" radius={CARD_RADIUS} onClick={() => router.push("/profit-tracker")} style={{ background: bg, cursor: "pointer", height: "100%" }}>
      <Stack gap="md" align="center">
        <Group gap={4} align="center">
          <Text c="dimmed" tt="uppercase" fw={600} style={CARD_LABEL_STYLE}>Gain / Loss</Text>
          <Tooltip label="Difference between your starting cash (set in Settings) and current account liquidation value, adjusted for deposits and withdrawals" withArrow multiline w={260} radius="xs">
            <IconInfoCircle size={13} style={{ color: "var(--mantine-color-dimmed)", cursor: "default", marginTop: 1 }} />
          </Tooltip>
        </Group>
        {snapshotLoading || balanceLoading ? (
          <Skeleton height={44} width={160} radius="sm" />
        ) : (
          <Text component="div">
            <AnimatedNumber
              value={totalGain == null ? "—" : mask(fmtMoney(totalGain))}
              className={outfit.className}
              style={{ fontSize: "2.75rem", fontWeight: 700, lineHeight: 1, color: gainColor }}
            />
          </Text>
        )}
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
