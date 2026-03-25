"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useApp } from "@/lib/context/AppContext";
import {
  NavLink,
  Drawer,
  UnstyledButton,
  Stack,
  Text,
  Group,
  Box,
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
  { href: "/",                    label: "Dashboard",    icon: IconLayoutDashboard },
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

// Desktop sidebar
export function SideNav() {
  const pathname = usePathname();
  const { alerts } = useApp();

  return (
    <Stack gap={4} p="xs">
      {ALL_PAGES.map(({ href, label, icon: Icon }) => {
        const warn = href === "/working-orders" && alerts.workingOrders === false;
        return (
        <NavLink
          key={href}
          component={Link}
          href={href}
          label={label}
          leftSection={<Icon size={18} color={warn ? "rgba(251,146,60,0.9)" : undefined} />}
          active={pathname === href}
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
  const { alerts } = useApp();

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
          const warn = href === "/working-orders" && alerts.workingOrders === false;
          return (
            <UnstyledButton
              key={href}
              component={Link}
              href={href}
              style={{ flex: 1, padding: "8px 0", textAlign: "center" }}
            >
              <Stack gap={2} align="center">
                <Icon size={20} color={warn ? "rgba(251,146,60,0.9)" : active ? "var(--mantine-color-blue-4)" : "var(--mantine-color-gray-5)"} />
                <Text size="xs" c={warn ? "orange.4" : active ? "blue.4" : "dimmed"}>{label}</Text>
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
            <IconDotsCircleHorizontal size={20} color="var(--mantine-color-gray-5)" />
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
          {MORE_PAGES.map(({ href, label, icon: Icon }) => (
            <NavLink
              key={href}
              component={Link}
              href={href}
              label={label}
              leftSection={<Icon size={18} />}
              active={pathname === href}
              onClick={() => setMoreOpen(false)}
            />
          ))}
        </Stack>
      </Drawer>
    </>
  );
}
