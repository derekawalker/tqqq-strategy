"use client";

import { Paper, Text, Stack, Group, Box, Skeleton } from "@mantine/core";
import { Outfit } from "next/font/google";

const outfit = Outfit({ subsets: ["latin"] });
import { useApp } from "@/lib/context/AppContext";
import { useAccountColor } from "@/lib/hooks/useAccountColor";
import { useCardBg } from "@/lib/hooks/useCardBg";
import { CARD_RADIUS, CARD_LABEL_STYLE } from "@/lib/cardStyles";
import { useBalances } from "@/lib/hooks/useBalances";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { fmt, createMask } from "@/lib/format";
import { usePendingBuyCost } from "@/lib/hooks/usePendingBuyCost";
import { useCSPCollateral } from "@/lib/hooks/useCSPCollateral";

const SEGMENTS = [
  { key: "tqqqValue",        label: "TQQQ",         color: "#339af0" },
  { key: "moneyMarketValue", label: "SWVXX & SGOV",  color: "#51cf66" },
  { key: "optionsValue",     label: "Options",       color: "#cc5de8" },
  { key: "cash",             label: "Cash",          color: "#fcc419" },
  { key: "otherValue",       label: "Other",         color: "#868e96" },
] as const;

type SegmentKey = typeof SEGMENTS[number]["key"];

export function AccountValueCard() {
  const { privacyMode } = useApp();
  const { balance, loading } = useBalances();
  const pendingBuyCost = usePendingBuyCost();
  const cspCollateral = useCSPCollateral();

  const mask = createMask(privacyMode);

  const color = useAccountColor("teal");
  const bg = useCardBg(color);

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
        <AnimatedNumber
          value={mask(`$${fmt(total, 0)}`)}
          className={outfit.className}
          style={{ fontSize: "4rem", fontWeight: 700, lineHeight: 1, color: "white", width: "100%" }}
        />

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
                  <Text size="xs" fw={500}>{mask(`$${fmt(s.value, 0)}`)}</Text>
                  <Text size="xs" c="dimmed" w={40} ta="right">{fmt(pct, 1)}%</Text>
                </Group>
              </Group>
            );
          })}
        </Stack>

        {/* Divider + pending / available */}
        <Stack gap={6} mt="auto">
          <Box style={{ height: 1, background: "var(--mantine-color-dark-4)" }} />
          {cspCollateral != null && (
            <Group justify="space-between">
              <Text size="xs" c="dimmed">CSP collateral</Text>
              <Text size="xs" fw={600} c="grape">
                {mask(`$${fmt(cspCollateral, 0)}`)}
              </Text>
            </Group>
          )}
          <Group justify="space-between">
            <Text size="xs" c="dimmed">Pending trades</Text>
            <Text size="xs" fw={600} c="orange">
              {pendingBuyCost != null ? mask(`$${fmt(pendingBuyCost, 0)}`) : "—"}
            </Text>
          </Group>
          <Group justify="space-between">
            <Text size="xs" c="dimmed">Available cash</Text>
            <Text size="xs" fw={600} c="teal">
              {balance != null ? mask(`$${fmt(balance.cashAvailableForTrading, 0)}`) : "—"}
            </Text>
          </Group>
        </Stack>
      </Stack>
    </Paper>
  );
}
