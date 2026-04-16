"use client";

import { Stack, Alert, Text } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import { usePathname } from "next/navigation";
import { useApp } from "@/lib/context/AppContext";
import type { Alerts } from "@/lib/context/AppContext";
import { useLevels } from "@/lib/hooks/useLevels";

// ── Style variables ────────────────────────────────────────────────────────────
const ALERT_COLOR   = "orange";
const ALERT_VARIANT = "light" as const;
const ALERT_ICON    = <IconAlertTriangle size={16} />;
const ALERT_PADDING = "md";
const ALERT_STYLES  = { root: { background: "linear-gradient(135deg, rgba(251,146,60,0.18) 0%, rgba(251,146,60,0.09) 100%)", boxShadow: "inset 2px 2px 6px rgba(0, 0, 0, 0.5)", border: "none" }, icon: { paddingLeft: 4 } };
const TITLE_SIZE    = "sm" as const;
const TITLE_WEIGHT  = 600;
const DESC_SIZE     = "sm" as const;
const DESC_COLOR    = "gray.5" as const;
const STACK_GAP     = "xs" as const;
// ──────────────────────────────────────────────────────────────────────────────

interface AlertContext {
  alerts: Alerts;
  tqqqShares: number;
  levelShares: number;
}

interface AlertDef {
  title: string;
  description: (ctx: AlertContext) => string;
  triggered: (alerts: Alerts) => boolean;
}

function fmtCash(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return `$${Math.round(n)}`;
}

const PAGE_ALERT_MAP: Record<string, AlertDef[]> = {
  "/": [
    {
      title: "Idle Cash",
      triggered: (a) => a.idleCash != null && a.idleCash > 3000,
      description: ({ alerts: a }) => `${fmtCash(a.idleCash!)} is sitting uninvested. Consider moving it to SGOV or SWVXX or selling puts.`,
    },
  ],
  "/levels": [
    {
      title: "Level Mismatch",
      triggered: (a) => a.levelMatch === false,
      description: ({ tqqqShares, levelShares }) =>
        `Schwab shows that you own ${tqqqShares.toLocaleString()} TQQQ shares, but the sum of the levels owned in this app show ${levelShares.toLocaleString()} shares.`,
    },
  ],
  "/working-orders": [
    {
      title: "Missing Orders",
      triggered: (a) => a.workingOrders === false,
      description: () => "One or more levels within your buffer are missing.",
    },
    {
      title: "Duplicate Orders",
      triggered: (a) => (a.duplicateOrders ?? 0) > 0,
      description: ({ alerts: a }) => `${a.duplicateOrders} duplicate working order${a.duplicateOrders === 1 ? "" : "s"} detected for the same level.`,
    },
  ],
  "/options": [
    {
      title: "Options Expiring Today",
      triggered: (a) => (a.expiringOptions ?? 0) > 0,
      description: ({ alerts: a }) => `${a.expiringOptions} option${a.expiringOptions === 1 ? "" : "s"} expire today. Review and act if needed.`,
    },
    {
      title: "In-the-Money Options",
      triggered: (a) => (a.itmOptions ?? 0) > 0,
      description: ({ alerts: a }) => `${a.itmOptions} option${a.itmOptions === 1 ? "" : "s"} are currently in the money.`,
    },
  ],
};

const TEST_ALERTS: Alerts = {
  levelMatch: false,
  workingOrders: false,
  duplicateOrders: 2,
  expiringOptions: 3,
  itmOptions: 1,
  idleCash: 15000,
};

export function PageAlertBanner() {
  const pathname = usePathname();
  const { alerts: realAlerts, tqqqShares } = useApp();
  const levelsSummary = useLevels();
  const testMode = typeof window !== "undefined" && window.location.search.includes("testAlerts");
  const alerts = testMode ? TEST_ALERTS : realAlerts;

  const levelShares = testMode
    ? 142
    : (levelsSummary?.ownedLevels.reduce((sum, l) => sum + l.shares, 0) ?? 0);

  const ctx: AlertContext = { alerts, tqqqShares, levelShares };

  const defs = PAGE_ALERT_MAP[pathname] ?? [];
  const active = defs.filter((d) => d.triggered(alerts));

  if (active.length === 0) return null;

  return (
    <Stack gap={STACK_GAP} mb="md">
      {active.map((d, i) => (
        <Alert key={i} color={ALERT_COLOR} variant={ALERT_VARIANT} icon={ALERT_ICON} p={ALERT_PADDING} styles={ALERT_STYLES}>
          <Text size={TITLE_SIZE} fw={TITLE_WEIGHT}>{d.title}</Text>
          <Text size={DESC_SIZE} c={DESC_COLOR}>{d.description(ctx)}</Text>
        </Alert>
      ))}
    </Stack>
  );
}
