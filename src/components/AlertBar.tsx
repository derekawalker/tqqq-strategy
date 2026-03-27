"use client";

import { SimpleGrid, Paper, Text, Group } from "@mantine/core";
import { useRouter } from "next/navigation";
import { IconCheck, IconAlertTriangle } from "@tabler/icons-react";
import { useApp } from "@/lib/context/AppContext";

interface AlertConfig {
  key: keyof ReturnType<typeof useApp>["alerts"];
  label: string;
  type: "check" | "count" | "cash";
  href: string;
}

const ALERT_CONFIGS: AlertConfig[] = [
  { key: "levelMatch",       label: "Level Match",      type: "check", href: "/levels" },
  { key: "workingOrders",    label: "Working Orders",   type: "check", href: "/working-orders" },
  { key: "duplicateOrders",  label: "Duplicate Orders", type: "count", href: "/working-orders" },
  { key: "expiringOptions",  label: "Expiring Options", type: "count", href: "/options" },
  { key: "itmOptions",       label: "ITM Options",      type: "count", href: "/options" },
  { key: "idleCash",         label: "Idle Cash",        type: "cash",  href: "/" },
];

const WARN_BG     = "rgba(251,146,60,0.15)";
const WARN_BORDER = "rgba(251,146,60,0.8)";
const WARN_ICON   = "rgba(251,146,60,0.9)";
const WARN_TEXT   = "rgba(251,146,60,1)";

function isTriggered(type: "check" | "count" | "cash", value: boolean | number | null): boolean {
  if (value === null) return false;
  if (type === "check") return value === false;
  return (value as number) > 0;
}

function fmtCash(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return `$${Math.round(n)}`;
}

export default function AlertBar() {
  const { alerts, activeAccount } = useApp();
  const router = useRouter();
  const color = activeAccount?.color ?? "dark";
  const idleBg = `light-dark(color-mix(in srgb, var(--mantine-color-${color}-2) 50%, white), var(--mantine-color-dark-6))`;

  return (
    <SimpleGrid cols={{ base: 3, sm: 6 }} spacing="xs">
      {ALERT_CONFIGS.map(({ key, label, type, href }) => {
        const value = alerts[key];
        const triggered = isTriggered(type, value);
        const textColor = triggered ? WARN_TEXT : "var(--mantine-color-gray-5)";

        return (
          <Paper
            key={key}
            radius="md"
            px="sm"
            py={6}
            onClick={() => router.push(href)}
            style={{
              background: triggered ? WARN_BG : idleBg,
              border: `1px solid ${triggered ? WARN_BORDER : "var(--mantine-color-dark-4)"}`,
              cursor: "pointer",
            }}
          >
            <Group gap={6} wrap="nowrap" align="center">
              {type === "check" ? (
                triggered
                  ? <IconAlertTriangle size={14} color={WARN_ICON} style={{ flexShrink: 0 }} />
                  : <IconCheck size={14} color="var(--mantine-color-gray-6)" style={{ flexShrink: 0 }} />
              ) : type === "cash" ? (
                triggered ? (
                  <Text fw={700} size="sm" lh={1} style={{ color: textColor, flexShrink: 0 }}>
                    {fmtCash(value as number)}
                  </Text>
                ) : (
                  <IconCheck size={14} color="var(--mantine-color-gray-6)" style={{ flexShrink: 0 }} />
                )
              ) : (
                <Text fw={700} size="sm" lh={1} style={{ color: textColor, flexShrink: 0 }}>
                  {value ?? "—"}
                </Text>
              )}
              <Text size="xs" lh={1.2} style={{ color: textColor }} truncate>
                {label}
              </Text>
            </Group>
          </Paper>
        );
      })}
    </SimpleGrid>
  );
}
