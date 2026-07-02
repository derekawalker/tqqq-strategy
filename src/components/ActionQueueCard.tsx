"use client";

import { Paper, Stack, Group, Text, ThemeIcon, Box, Skeleton } from "@mantine/core";
import { useRouter } from "next/navigation";
import {
  IconShieldOff,
  IconChartCandle,
  IconList,
  IconRadar,
  IconChecklist,
} from "@tabler/icons-react";
import { CARD_RADIUS, CARD_LABEL_STYLE } from "@/lib/cardStyles";
import { useCardBg } from "@/lib/hooks/useCardBg";
import { useActionQueue } from "@/lib/hooks/useActionQueue";
import type { QueueAction, QueueSource } from "@/lib/dashboardActions";

const SOURCE_ICONS: Record<QueueSource, React.ReactNode> = {
  hedge: <IconShieldOff size={14} />,
  options: <IconChartCandle size={14} />,
  ladder: <IconList size={14} />,
  regime: <IconRadar size={14} />,
};

function awayLabel(daysAway: number): string {
  if (daysAway <= 0) return "Now";
  if (daysAway === 1) return "1 day";
  return `${daysAway} days`;
}

function ActionRow({ action, index }: { action: QueueAction; index: number }) {
  const router = useRouter();
  const color = action.color === "dimmed" ? "gray" : action.color;
  const isNext = index === 0;
  return (
    <Group
      gap="sm"
      align="flex-start"
      wrap="nowrap"
      onClick={() => router.push(action.href)}
      style={{ cursor: "pointer" }}
    >
      <ThemeIcon
        size={isNext ? "md" : "sm"}
        variant={isNext ? "filled" : "light"}
        color={color}
        radius="xl"
        mt={1}
        style={{ flexShrink: 0 }}
      >
        {SOURCE_ICONS[action.source]}
      </ThemeIcon>
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Group justify="space-between" gap="xs" wrap="nowrap" align="flex-start">
          <Text size="sm" fw={isNext ? 700 : 600}>{action.title}</Text>
          <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>{awayLabel(action.daysAway)}</Text>
        </Group>
        <Text size="xs" c="dimmed">{action.detail}</Text>
      </Box>
    </Group>
  );
}

/**
 * Unified daily action queue: hedge rolls/monetize/buys, short-option exit
 * signals, near-spot ladder buys/sells, and regime advisories in one ordered
 * checklist, so the day starts with a single glance instead of four pages.
 */
export function ActionQueueCard() {
  const bg = useCardBg("dark");
  const actions = useActionQueue();

  if (actions === null) {
    return (
      <Paper p="md" radius={CARD_RADIUS} style={{ background: bg }}>
        <Stack gap="sm">
          <Skeleton height={12} width={140} radius="sm" />
          <Skeleton height={40} radius="sm" />
          <Skeleton height={40} radius="sm" />
        </Stack>
      </Paper>
    );
  }

  if (actions.length === 0) {
    return (
      <Paper p="md" radius={CARD_RADIUS} style={{ background: bg }}>
        <Group gap="xs" align="center">
          <ThemeIcon size="sm" variant="light" color="teal" radius="xl">
            <IconChecklist size={14} />
          </ThemeIcon>
          <Text size="sm" c="dimmed">Nothing needs attention right now.</Text>
        </Group>
      </Paper>
    );
  }

  const shown = actions.slice(0, 5);

  return (
    <Paper p="md" radius={CARD_RADIUS} style={{ background: bg }}>
      <Text size="xs" fw={700} tt="uppercase" style={CARD_LABEL_STYLE} mb="sm">
        Today&apos;s Actions
      </Text>
      <Stack gap="sm">
        {shown.map((action, i) => (
          <ActionRow key={`${action.source}-${action.kind}-${i}`} action={action} index={i} />
        ))}
        {actions.length > shown.length && (
          <Text size="9px" c="dimmed" ta="right">+{actions.length - shown.length} more</Text>
        )}
      </Stack>
    </Paper>
  );
}
