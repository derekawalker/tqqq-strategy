"use client";

import { Paper, Text, Stack, Box, Group } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/context/AppContext";
import { useLevels } from "@/lib/hooks/useLevels";
import { useCardBg } from "@/lib/hooks/useCardBg";
import { CARD_RADIUS, CARD_LABEL_STYLE } from "@/lib/cardStyles";

export function CurrentLevelCard() {
  const { activeAccount } = useApp();
  const levelsSummary = useLevels();
  const color = activeAccount?.color ?? "teal";
  const bg = useCardBg(color);
  const router = useRouter();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const window = isMobile ? 4 : 8;

  if (!levelsSummary || levelsSummary.currentLevel < 0) {
    return (
      <Paper p="md" radius={CARD_RADIUS} onClick={() => router.push("/levels")} style={{ background: bg, cursor: "pointer", height: "100%" }}>
        <Stack align="center" gap={8}>
          <Text c="dimmed" tt="uppercase" fw={600} style={CARD_LABEL_STYLE}>Current Level</Text>
          <Text size="sm" c="dimmed">—</Text>
        </Stack>
      </Paper>
    );
  }

  const { levels, currentLevel } = levelsSummary;
  const start = Math.max(0, currentLevel - window);
  const end = Math.min(levels.length - 1, currentLevel + window);

  return (
    <Paper p="md" radius={CARD_RADIUS} onClick={() => router.push("/levels")} style={{ background: bg, cursor: "pointer", height: "100%" }}>
      <Stack align="center" gap={12} pt={isMobile ? 0 : "md"}>
        <Text c="dimmed" tt="uppercase" fw={600} style={CARD_LABEL_STYLE}>Current Level</Text>
        <Group gap={0} wrap="nowrap" justify="center">
          {Array.from({ length: end - start + 1 }, (_, i) => {
            const idx = start + i;
            const isCurrent = idx === currentLevel;
            const dist = Math.abs(idx - currentLevel);
            const t = dist / window;
            const curve = t * t * t; // cubic: stays large near center, drops fast at edge
            const size = Math.max(8, Math.round(36 - curve * 28));
            const opacity = Math.max(0.12, 1 - t * t * 0.88);
            const fontSize = Math.max(7, size * 0.46);
            const translateY = 0;
            const gapRight = idx < end ? Math.max(0, Math.round(7 * (1 - t * t))) : 0;
            return (
              <Box
                key={idx}
                style={{
                  width: size,
                  height: size,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  marginRight: gapRight,
                  opacity,
                  transform: `translateY(${translateY}px)`,
                  background: isCurrent ? `var(--mantine-color-${color}-6)` : "transparent",
                  border: `2px solid ${isCurrent ? `var(--mantine-color-${color}-6)` : "light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-4))"}`,
                  transition: "all 0.15s ease",
                }}
              >
                <Text
                  fw={isCurrent ? 700 : 400}
                  c={isCurrent ? "white" : "dimmed"}
                  lh={1}
                  style={{ fontSize }}
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
