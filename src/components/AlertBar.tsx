"use client";

import { SimpleGrid, Paper, Text, Group } from "@mantine/core";
import { IconCheck, IconAlertTriangle } from "@tabler/icons-react";
import { useComputedColorScheme } from "@mantine/core";
import { useApp } from "@/lib/context/AppContext";

interface AlertConfig {
  key: keyof ReturnType<typeof useApp>["alerts"];
  label: string;
  type: "check" | "count";
}

const ALERT_CONFIGS: AlertConfig[] = [
  { key: "gridMatch",        label: "Grid Match",      type: "check" },
  { key: "workingOrders",    label: "Working Orders",  type: "check" },
  { key: "duplicateOrders",  label: "Duplicate Orders", type: "count" },
  { key: "expiringOptions",  label: "Expiring Options",type: "count" },
  { key: "itmOptions",       label: "ITM Options",     type: "count" },
];

function isTriggered(type: "check" | "count", value: boolean | number | null): boolean {
  if (value === null) return false;
  if (type === "check") return value === false;
  return (value as number) > 0;
}

export default function AlertBar() {
  const { alerts } = useApp();
  const computedColorScheme = useComputedColorScheme("dark");
  const isDark = computedColorScheme === "dark";

  return (
    <SimpleGrid cols={{ base: 3, sm: 5 }} spacing="xs">
      {ALERT_CONFIGS.map(({ key, label, type }) => {
        const value = alerts[key];
        const triggered = isTriggered(type, value);

        const bg = triggered
          ? isDark ? "var(--mantine-color-yellow-9)" : "var(--mantine-color-yellow-1)"
          : isDark ? "var(--mantine-color-dark-6)" : "var(--mantine-color-gray-1)";

        const borderColor = triggered
          ? "var(--mantine-color-yellow-6)"
          : isDark ? "var(--mantine-color-dark-4)" : "var(--mantine-color-gray-3)";

        return (
          <Paper
            key={key}
            radius="md"
            p="xs"
            style={{ background: bg, border: `1px solid ${borderColor}`, textAlign: "center" }}
          >
            <Group justify="center" mb={4}>
              {type === "check" ? (
                triggered
                  ? <IconAlertTriangle size={20} color="var(--mantine-color-yellow-5)" />
                  : <IconCheck size={20} color={isDark ? "var(--mantine-color-gray-5)" : "var(--mantine-color-gray-6)"} />
              ) : (
                <Text
                  fw={700}
                  size="lg"
                  c={triggered ? "yellow.5" : "dimmed"}
                  lh={1}
                >
                  {value ?? "—"}
                </Text>
              )}
            </Group>
            <Text size="xs" c="dimmed" lh={1.2}>{label}</Text>
          </Paper>
        );
      })}
    </SimpleGrid>
  );
}
