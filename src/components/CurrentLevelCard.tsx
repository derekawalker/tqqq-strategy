"use client";

import { Paper, Text, Stack, Box, Group } from "@mantine/core";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/context/AppContext";
import { useLevels } from "@/lib/hooks/useLevels";
import { useCardBg } from "@/lib/hooks/useCardBg";

const WINDOW = 6; // levels to show on each side of current

export function CurrentLevelCard() {
  const { activeAccount } = useApp();
  const levelsSummary = useLevels();
  const color = activeAccount?.color ?? "teal";
  const bg = useCardBg(color);
  const router = useRouter();

  if (!levelsSummary || levelsSummary.currentLevel < 0) {
    return (
      <Paper p="md" radius="md" withBorder onClick={() => router.push("/levels")} style={{ gridColumn: "span 3", background: bg, cursor: "pointer" }}>
        <Stack align="center" gap={8}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600} lts={0.5}>Current Level</Text>
          <Text size="sm" c="dimmed">—</Text>
        </Stack>
      </Paper>
    );
  }

  const { levels, currentLevel } = levelsSummary;
  const start = Math.max(0, currentLevel - WINDOW);
  const end = Math.min(levels.length - 1, currentLevel + WINDOW);
  const visible = levels.slice(start, end + 1);

  return (
    <Paper p="md" radius="md" withBorder onClick={() => router.push("/levels")} style={{ gridColumn: "span 3", background: bg, cursor: "pointer" }}>
      <Stack align="center" gap={12}>
        <Text size="xs" c="dimmed" tt="uppercase" fw={600} lts={0.5}>Current Level</Text>
        <Group gap={6} wrap="nowrap" justify="center">
          {visible.map((_, i) => {
            const idx = start + i;
            const isCurrent = idx === currentLevel;
            return (
              <Box
                key={idx}
                style={{
                  width: isCurrent ? 48 : 36,
                  height: isCurrent ? 48 : 36,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: isCurrent
                    ? `var(--mantine-color-${color}-6)`
                    : "transparent",
                  border: `2px solid ${isCurrent ? `var(--mantine-color-${color}-6)` : "light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-4))"}`,
                  flexShrink: 0,
                  transition: "all 0.15s ease",
                }}
              >
                <Text
                  size={isCurrent ? "md" : "sm"}
                  fw={isCurrent ? 700 : 400}
                  c={isCurrent ? "white" : "dimmed"}
                  lh={1}
                >
                  {idx}
                </Text>
              </Box>
            );
          })}
        </Group>
      </Stack>
    </Paper>
  );
}
