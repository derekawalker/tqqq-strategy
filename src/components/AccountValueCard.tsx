"use client";

import { useMemo } from "react";
import { Paper, Text, Stack, Group, Box, Skeleton } from "@mantine/core";
import { Outfit } from "next/font/google";

const outfit = Outfit({ subsets: ["latin"] });
import { useApp } from "@/lib/context/AppContext";
import { useCardBg } from "@/lib/hooks/useCardBg";
import { CARD_RADIUS, CARD_LABEL_STYLE } from "@/lib/cardStyles";
import { useBalances } from "@/lib/hooks/useBalances";
import { useLevels } from "@/lib/hooks/useLevels";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const fmtPct = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const SEGMENTS = [
  { key: "tqqqValue",        label: "TQQQ",         color: "#339af0" },
  { key: "moneyMarketValue", label: "SWVXX & SGOV",  color: "#51cf66" },
  { key: "optionsValue",     label: "Options",       color: "#cc5de8" },
  { key: "cash",             label: "Cash",          color: "#fcc419" },
  { key: "otherValue",       label: "Other",         color: "#868e96" },
] as const;

type SegmentKey = typeof SEGMENTS[number]["key"];

export function AccountValueCard() {
  const { privacyMode, activeAccount, workingOrders } = useApp();
  const { balance, loading } = useBalances();
  const levelsSummary = useLevels();

  const mask = (val: string) => (privacyMode ? "••••" : val);

  // Pending buy cost — same logic as working orders page
  const pendingBuyCost = useMemo(() => {
    if (!levelsSummary) return null;

    const ownedLevelIndices = new Set(
      levelsSummary.ownedLevels.map((l) =>
        levelsSummary.levels.findIndex(
          (ll) => ll.shares === l.shares && ll.buyPrice === l.buyPrice
        )
      )
    );

    const counts = new Map<number, { buys: number; buyPrice: number | null }>();
    for (const o of workingOrders) {
      if (o.side !== "BUY") continue;
      const existing = counts.get(o.shares);
      const idx = levelsSummary.levels.findIndex((l) => l.shares === o.shares);
      const buyPrice = idx >= 0 ? levelsSummary.levels[idx].buyPrice : null;
      if (!existing) {
        counts.set(o.shares, { buys: 1, buyPrice });
      } else {
        counts.set(o.shares, { ...existing, buys: existing.buys + 1 });
      }
    }

    let total = 0;
    for (const [shares, { buys, buyPrice }] of counts) {
      if (buys === 0 || buyPrice == null) continue;
      const idx = levelsSummary.levels.findIndex((l) => l.shares === shares);
      if (idx >= 0 && ownedLevelIndices.has(idx)) continue;
      total += shares * buyPrice;
    }
    return total;
  }, [workingOrders, levelsSummary]);

  if (loading && !balance) {
    return (
      <Paper p="md" radius={CARD_RADIUS} style={{ background: "var(--mantine-color-dark-8)", height: "100%" }}>
        <Stack gap="sm">
          <Skeleton height={20} width={140} />
          <Skeleton height={12} radius={CARD_RADIUS} />
          <Skeleton height={60} />
        </Stack>
      </Paper>
    );
  }

  const total = balance?.totalValue ?? 0;
  const color = activeAccount?.color ?? "teal";
  const bg = useCardBg(color);

  const segments = SEGMENTS.map((s) => ({
    ...s,
    value: balance ? (balance[s.key as SegmentKey] as number) : 0,
  }));

  return (
    <Paper p="md" radius={CARD_RADIUS} style={{ background: bg, height: "100%" }}>
      <Stack gap="md" h="100%">
        {/* Title + total */}
        <Group justify="space-between" align="flex-start">
          <Text c="dimmed" tt="uppercase" fw={600} ta="center" w="100%" style={CARD_LABEL_STYLE}>Account Value</Text>
        </Group>
        <Text fw={700} lh={1} ta="center" className={outfit.className} style={{ fontSize: "4rem", width: "100%", color: "light-dark(var(--mantine-color-dark-9), white)" }}>
          {mask(`$${fmt(total)}`)}
        </Text>

        {/* Progress bar */}
        <Box>
          <Box
            style={{
              display: "flex",
              height: 20,
              borderRadius: 6,
              overflow: "hidden",
              background: "var(--mantine-color-dark-4)",
            }}
          >
            {total > 0
              ? segments.map((s) => {
                  const pct = (s.value / total) * 100;
                  if (pct < 0.1) return null;
                  return (
                    <Box
                      key={s.key}
                      style={{
                        width: `${pct}%`,
                        height: "100%",
                        background: s.color,
                        flexShrink: 0,
                      }}
                    />
                  );
                })
              : null}
          </Box>
        </Box>

        {/* Legend */}
        <Stack gap={4}>
          {segments.map((s) => {
            const pct = total > 0 ? (s.value / total) * 100 : 0;
            if (s.value === 0 && pct === 0) return null;
            return (
              <Group key={s.key} justify="space-between" wrap="nowrap">
                <Group gap={6} wrap="nowrap">
                  <Box style={{ width: 10, height: 10, borderRadius: 2, background: s.color, flexShrink: 0 }} />
                  <Text size="xs" c="dimmed">{s.label}</Text>
                </Group>
                <Group gap={8} wrap="nowrap">
                  <Text size="xs" fw={500}>{mask(`$${fmt(s.value)}`)}</Text>
                  <Text size="xs" c="dimmed" w={40} ta="right">{fmtPct(pct)}%</Text>
                </Group>
              </Group>
            );
          })}
        </Stack>

        {/* Divider + pending / available */}
        <Stack gap={6} mt="auto">
          <Box style={{ height: 1, background: "var(--mantine-color-dark-4)" }} />
          <Group justify="space-between">
            <Text size="xs" c="dimmed">Pending trades</Text>
            <Text size="xs" fw={600} c="orange">
              {pendingBuyCost != null ? mask(`$${fmt(pendingBuyCost)}`) : "—"}
            </Text>
          </Group>
          <Group justify="space-between">
            <Text size="xs" c="dimmed">Available cash</Text>
            <Text size="xs" fw={600} c="teal">
              {balance != null ? mask(`$${fmt(balance.cashAvailableForTrading)}`) : "—"}
            </Text>
          </Group>
        </Stack>
      </Stack>
    </Paper>
  );
}
