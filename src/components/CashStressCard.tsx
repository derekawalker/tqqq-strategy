"use client";

import { Paper, Text, Stack, Group, Tooltip } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/context/AppContext";
import { createMask } from "@/lib/format";
import { useAccountColor } from "@/lib/hooks/useAccountColor";
import { useCardBg } from "@/lib/hooks/useCardBg";
import { useCashStress } from "@/lib/hooks/useCashStress";
import { CARD_RADIUS, CARD_LABEL_STYLE } from "@/lib/cardStyles";

function fmtMoney(n: number) {
  const prefix = n < 0 ? "-$" : "$";
  return `${prefix}${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/**
 * Cash double-commitment stress card: in a fast drop, unpurchased ladder
 * levels and open short TQQQ put assignments both pull from the same cash
 * pool. This shows the worst-case shortfall across a price sweep.
 */
export function CashStressCard() {
  const { privacyMode } = useApp();
  const color = useAccountColor("dark");
  const bg = useCardBg(color);
  const router = useRouter();
  const mask = createMask(privacyMode);
  const stress = useCashStress();

  if (!stress || stress.points.length === 0) {
    return (
      <Paper p="md" radius={CARD_RADIUS} onClick={() => router.push("/levels")} style={{ background: bg, cursor: "pointer", height: "100%" }}>
        <Stack align="center" gap={8} justify="center" style={{ height: "100%" }}>
          <Text c="dimmed" tt="uppercase" fw={600} style={CARD_LABEL_STYLE}>Cash Stress</Text>
          <Text size="sm" c="dimmed">—</Text>
        </Stack>
      </Paper>
    );
  }

  const { worst, cashAvailable } = stress;
  const hasShortfall = (worst?.shortfall ?? 0) > 0;
  const headline = worst
    ? hasShortfall
      ? `-${mask(fmtMoney(worst.shortfall))}`
      : `+${mask(fmtMoney(-worst.shortfall))}`
    : "—";
  const headlineColor = hasShortfall ? "var(--mantine-color-red-6)" : "white";

  return (
    <Paper p="md" radius={CARD_RADIUS} onClick={() => router.push("/levels")} style={{ background: bg, cursor: "pointer", height: "100%" }}>
      <Stack gap="xs" align="center" justify="center" style={{ height: "100%" }}>
        <Group gap={4} align="center">
          <Text c="dimmed" tt="uppercase" fw={600} style={CARD_LABEL_STYLE}>Cash Stress</Text>
          <Tooltip
            label="Worst-case shortfall if the ladder's remaining buy levels and any open short TQQQ puts all get hit in a fast drop, vs. cash available now."
            withArrow
            multiline
            w={260}
            radius="xs"
          >
            <IconInfoCircle size={13} style={{ color: "var(--mantine-color-dimmed)", cursor: "default", marginTop: 1 }} />
          </Tooltip>
        </Group>
        <Text fw={700} style={{ fontSize: "1.75rem", lineHeight: 1, color: headlineColor }}>
          {headline}
        </Text>
        {worst && (
          <Text size="xs" c="dimmed" ta="center">
            {hasShortfall ? "short" : "surplus"} at ${worst.price.toFixed(2)} ({worst.pctFromCurrent.toFixed(0)}%) ·
            {" "}need {mask(fmtMoney(worst.totalNeeded))}, have {mask(fmtMoney(cashAvailable))}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}
