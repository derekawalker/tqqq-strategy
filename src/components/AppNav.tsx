"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore, useRef, useEffect } from "react";
import { useApp } from "@/lib/context/AppContext";
import type { Alerts } from "@/lib/context/AppContext";
import { useAccountColor } from "@/lib/hooks/useAccountColor";

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
  IconHistory,
  IconColumns3,
  IconDotsCircleHorizontal,
  IconRadar,
  IconShieldHalf,
} from "@tabler/icons-react";

const ALL_PAGES = [
  { href: "/",                    label: "Dash",       icon: IconLayoutDashboard },
  { href: "/levels",              label: "Levels",     icon: IconList },
  { href: "/working-orders",      label: "Working",    icon: IconClockHour4 },
  { href: "/filled-orders",       label: "Filled",     icon: IconCheckbox },
  { href: "/options",             label: "Options",    icon: IconChartCandle },
  { href: "/hedge",               label: "Hedge",      icon: IconShieldHalf },
  { href: "/profit-tracker",      label: "Profit",     icon: IconTrendingUp },
  { href: "/interest-dividends",  label: "Interest",   icon: IconCoins },
  { href: "/chart",               label: "Chart",      icon: IconChartLine },
  { href: "/sentiment",           label: "Sentiment",  icon: IconRadar },
  { href: "/history",             label: "History",    icon: IconHistory },
];

const TAB_PAGES = ALL_PAGES.slice(0, 5);
const MORE_PAGES = ALL_PAGES.slice(5);

const PAGE_WARN: Record<string, (a: Alerts) => boolean> = {
  "/":               (a) => a.idleCash != null && a.idleCash > 3000,
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

function useTestMode() {
  return useSyncExternalStore(
    () => () => {},
    () => window.location.search.includes("testAlerts"),
    () => false,
  );
}

// Desktop sidebar
export function SideNav() {
  const pathname = usePathname();
  const { alerts: realAlerts } = useApp();
  const testMode = useTestMode();
  const alerts = testMode ? TEST_ALERTS : realAlerts;
  const color = useAccountColor();

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
  const { alerts: realAlerts } = useApp();
  const testMode = useTestMode();
  const alerts = testMode ? TEST_ALERTS : realAlerts;
  const color = useAccountColor();
  const moreWarn = MORE_PAGES.some(({ href }) => PAGE_WARN[href]?.(alerts) ?? false);
  const navRef = useRef<HTMLDivElement>(null);

  // Publish the nav's real height so the scrolling content pane (globals.css) ends exactly at its
  // top edge, whatever the safe-area inset or text metrics turn out to be on the device.
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const root = document.documentElement;
    const ro = new ResizeObserver(() => root.style.setProperty("--bottom-nav-height", `${el.offsetHeight}px`));
    ro.observe(el);

    // iOS standalone PWAs can give the layout viewport (what position:fixed is measured against)
    // a height shorter than the screen, leaving a dead band under anything pinned to bottom:0.
    // Measure the band (visual viewport height minus layout viewport height) and push the nav down
    // into it. Bounded so the keyboard never counts.
    const measureShim = () => {
      const standalone = window.matchMedia("(display-mode: standalone)").matches
        || (navigator as Navigator & { standalone?: boolean }).standalone === true;
      const diff = window.innerHeight - document.documentElement.clientHeight;
      const shim = standalone && diff > 0 && diff <= 120 ? diff : 0;
      root.style.setProperty("--ios-bottom-shim", `${shim}px`);
    };
    measureShim();
    window.addEventListener("resize", measureShim);
    window.addEventListener("orientationchange", measureShim);
    document.addEventListener("visibilitychange", measureShim);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measureShim);
      window.removeEventListener("orientationchange", measureShim);
      document.removeEventListener("visibilitychange", measureShim);
      root.style.removeProperty("--bottom-nav-height");
      root.style.removeProperty("--ios-bottom-shim");
    };
  }, []);

  return (
    <>
      <Box
        ref={navRef}
        className="app-bottom-nav"
        style={{
          position: "fixed",
          bottom: "calc(-1 * var(--ios-bottom-shim, 0px))",
          left: 0,
          right: 0,
          zIndex: 100,
          borderTop: "1px solid var(--mantine-color-dark-4)",
          background: "var(--mantine-color-dark-7)",
          display: "flex",
          // Inset from the rounded screen corners and home-indicator area so the
          // first/last tabs and bottom padding stay within the tappable region.
          paddingLeft: "max(8px, env(safe-area-inset-left))",
          paddingRight: "max(8px, env(safe-area-inset-right))",
          paddingBottom: "env(safe-area-inset-bottom)",
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
