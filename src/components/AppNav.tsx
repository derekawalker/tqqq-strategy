"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useApp } from "@/lib/context/AppContext";
import type { Alerts } from "@/lib/context/AppContext";

const TEST_ALERTS: Alerts = {
  levelMatch: false,
  workingOrders: false,
  duplicateOrders: 2,
  expiringOptions: 3,
  itmOptions: 1,
  idleCash: 15000,
};
import {
  NavLink,
  Drawer,
  UnstyledButton,
  Stack,
  Text,
  Box,
  Indicator,
} from "@mantine/core";
import {
  IconLayoutDashboard,
  IconList,
  IconClockHour4,
  IconCheckbox,
  IconTrendingUp,
  IconChartCandle,
  IconCoins,
  IconChartLine,
  IconDotsCircleHorizontal,
} from "@tabler/icons-react";

const ALL_PAGES = [
  { href: "/",                    label: "Dash",    icon: IconLayoutDashboard },
  { href: "/levels",              label: "Levels",       icon: IconList },
  { href: "/working-orders",      label: "Working",      icon: IconClockHour4 },
  { href: "/filled-orders",       label: "Filled",       icon: IconCheckbox },
  { href: "/profit-tracker",      label: "Profit",       icon: IconTrendingUp },
  { href: "/options",             label: "Options",      icon: IconChartCandle },
  { href: "/interest-dividends",  label: "Interest",     icon: IconCoins },
  { href: "/chart",               label: "Chart",        icon: IconChartLine },
];

const TAB_PAGES = ALL_PAGES.slice(0, 5);
const MORE_PAGES = ALL_PAGES.slice(5);

const PAGE_WARN: Record<string, (a: Alerts) => boolean> = {
  "/":               (a) => a.idleCash != null && a.idleCash > 1000,
  "/levels":         (a) => a.levelMatch === false,
  "/working-orders": (a) => a.workingOrders === false || (a.duplicateOrders ?? 0) > 0,
  "/options":        (a) => (a.expiringOptions ?? 0) > 0 || (a.itmOptions ?? 0) > 0,
};

function NavIcon({ Icon, warn }: { Icon: React.ElementType; warn: boolean }) {
  return (
    <Indicator color="orange" size={7} disabled={!warn} offset={2}>
      <Icon size={18} />
    </Indicator>
  );
}

// Desktop sidebar
export function SideNav() {
  const pathname = usePathname();
  const { alerts: realAlerts, activeAccount } = useApp();
  const testMode = typeof window !== "undefined" && window.location.search.includes("testAlerts");
  const alerts = testMode ? TEST_ALERTS : realAlerts;
  const color = activeAccount?.color ?? "blue";

  return (
    <Stack gap={4} p="xs">
      {ALL_PAGES.map(({ href, label, icon: Icon }) => {
        const warn = PAGE_WARN[href]?.(alerts) ?? false;
        return (
          <NavLink
            key={href}
            component={Link}
            href={href}
            label={label}
            leftSection={<NavIcon Icon={Icon} warn={warn} />}
            active={pathname === href}
            color={color}
          />
        );
      })}
    </Stack>
  );
}

// Mobile bottom tab bar
export function BottomNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const { alerts: realAlerts, activeAccount } = useApp();
  const testMode = typeof window !== "undefined" && window.location.search.includes("testAlerts");
  const alerts = testMode ? TEST_ALERTS : realAlerts;
  const color = activeAccount?.color ?? "blue";
  const moreWarn = MORE_PAGES.some(({ href }) => PAGE_WARN[href]?.(alerts) ?? false);

  return (
    <>
      <Box
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          borderTop: "1px solid var(--mantine-color-dark-4)",
          background: "var(--mantine-color-dark-7)",
          display: "flex",
        }}
      >
        {TAB_PAGES.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          const warn = PAGE_WARN[href]?.(alerts) ?? false;
          return (
            <UnstyledButton
              key={href}
              component={Link}
              href={href}
              style={{ flex: 1, padding: "8px 0", textAlign: "center" }}
            >
              <Stack gap={2} align="center">
                <Indicator color="orange" size={7} disabled={!warn} offset={2}>
                  <Icon size={20} color={active ? `var(--mantine-color-${color}-4)` : "var(--mantine-color-gray-5)"} />
                </Indicator>
                <Text size="xs" c={active ? `${color}.4` : "dimmed"}>{label}</Text>
              </Stack>
            </UnstyledButton>
          );
        })}

        {/* More button */}
        <UnstyledButton
          onClick={() => setMoreOpen(true)}
          style={{ flex: 1, padding: "8px 0", textAlign: "center" }}
        >
          <Stack gap={2} align="center">
            <Indicator color="orange" size={7} disabled={!moreWarn} offset={2}>
              <IconDotsCircleHorizontal size={20} color="var(--mantine-color-gray-5)" />
            </Indicator>
            <Text size="xs" c="dimmed">More</Text>
          </Stack>
        </UnstyledButton>
      </Box>

      <Drawer
        opened={moreOpen}
        onClose={() => setMoreOpen(false)}
        title="More"
        position="bottom"
        size="xs"
      >
        <Stack gap="xs">
          {MORE_PAGES.map(({ href, label, icon: Icon }) => {
            const warn = PAGE_WARN[href]?.(alerts) ?? false;
            return (
              <NavLink
                key={href}
                component={Link}
                href={href}
                label={label}
                leftSection={<NavIcon Icon={Icon} warn={warn} />}
                active={pathname === href}
                color={color}
                onClick={() => setMoreOpen(false)}
              />
            );
          })}
        </Stack>
      </Drawer>
    </>
  );
}
