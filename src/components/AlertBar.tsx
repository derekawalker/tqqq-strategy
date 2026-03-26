"use client";

import { SimpleGrid, Paper, Text, Group } from "@mantine/core";
import { useRouter } from "next/navigation";
import { IconCheck, IconAlertTriangle } from "@tabler/icons-react";
import { useApp } from "@/lib/context/AppContext";

interface AlertConfig {
  key: keyof ReturnType<typeof useApp>["alerts"];
  label: string;
  type: "check" | "count";
  href: string;
}

const ALERT_CONFIGS: AlertConfig[] = [
  { key: "levelMatch",       label: "Level Match",      type: "check", href: "/levels" },
  { key: "workingOrders",    label: "Working Orders",   type: "check", href: "/working-orders" },
  { key: "duplicateOrders",  label: "Duplicate Orders", type: "count", href: "/working-orders" },
  { key: "expiringOptions",  label: "Expiring Options", type: "count", href: "/options" },
  { key: "itmOptions",       label: "ITM Options",      type: "count", href: "/options" },
];

const WARN_BG     = "rgba(251,146,60,0.15)";
const WARN_BORDER = "rgba(251,146,60,0.8)";
const WARN_ICON   = "rgba(251,146,60,0.9)";
const WARN_TEXT   = "rgba(251,146,60,1)";

function isTriggered(type: "check" | "count", value: boolean | number | null): boolean {
  if (value === null) return false;
  if (type === "check") return value === false;
  return (value as number) > 0;
}

export default function AlertBar() {
  const { alerts } = useApp();
  const router = useRouter();

  return (
    <SimpleGrid cols={{ base: 3, sm: 5 }} spacing="xs">
      {ALERT_CONFIGS.map(({ key, label, type, href }) => {
        const value = alerts[key];
        const triggered = isTriggered(type, value);

        return (
          <Paper
            key={key}
            radius="md"
            p="xs"
            onClick={() => router.push(href)}
            style={{
              background: triggered ? WARN_BG : "var(--mantine-color-dark-6)",
              border: `1px solid ${triggered ? WARN_BORDER : "var(--mantine-color-dark-4)"}`,
              textAlign: "center",
              cursor: "pointer",
            }}
          >
            <Group justify="center" mb={4}>
              {type === "check" ? (
                triggered
                  ? <IconAlertTriangle size={20} color={WARN_ICON} />
                  : <IconCheck size={20} color="var(--mantine-color-gray-6)" />
              ) : (
                <Text fw={700} size="lg" lh={1} style={{ color: triggered ? WARN_TEXT : "var(--mantine-color-gray-5)" }}>
                  {value ?? "—"}
                </Text>
              )}
            </Group>
            <Text size="xs" lh={1.2} style={{ color: triggered ? WARN_TEXT : "var(--mantine-color-gray-5)" }}>
              {label}
            </Text>
          </Paper>
        );
      })}
    </SimpleGrid>
  );
}
