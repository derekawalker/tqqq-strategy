"use client";

import { useState, useEffect, ReactNode } from "react";
import { AppShell, Box, useComputedColorScheme } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import AppHeader from "@/components/AppHeader";
import AlertBar from "@/components/AlertBar";
import SettingsModal from "@/components/SettingsModal";
import { SideNav, BottomNav } from "@/components/AppNav";
import { useApp } from "@/lib/context/AppContext";
import { useLevels } from "@/lib/hooks/useLevels";

const NAVBAR_WIDTH = 180;

export default function AppShellLayout({ children }: { children: ReactNode }) {
  const { activeAccount, setQuote, refreshTick, tickRefresh, tqqqShares, setAlerts, workingOrders, optionPositions, quote } = useApp();
  const levelsSummary = useLevels();
  const computedColorScheme = useComputedColorScheme("dark");
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const s = activeAccount?.settings;
    const threshold = s?.orderWarnBelow ?? 0;
    const bufferSize = s?.orderBuffer ?? 0;
    const currentLevel = levelsSummary?.currentLevel ?? -1;

    const counts = new Map<number, { buys: number; sells: number }>();
    for (const o of workingOrders) {
      const c = counts.get(o.shares) ?? { buys: 0, sells: 0 };
      if (o.side === "BUY") c.buys++; else c.sells++;
      counts.set(o.shares, c);
    }

    let hasWarning = false;
    if (levelsSummary) {
      for (let i = 0; i < levelsSummary.levels.length; i++) {
        const level = levelsSummary.levels[i];
        const c = counts.get(level.shares) ?? { buys: 0, sells: 0 };
        const inBuffer = bufferSize > 0 && i !== currentLevel && Math.abs(i - currentLevel) <= bufferSize;
        if (inBuffer && (c.buys === 0 || c.sells === 0)) { hasWarning = true; break; }
        if ((c.buys > 0 || c.sells > 0) && threshold > 0 && (c.buys < threshold || c.sells < threshold)) { hasWarning = true; break; }
      }
    }
    // Duplicate detection: count WORKING-status orders with same side + shares
    const workingOnly = workingOrders.filter((o) => o.status === "WORKING");
    const workingCounts = new Map<string, number>();
    for (const o of workingOnly) {
      const key = `${o.side}-${o.shares}`;
      workingCounts.set(key, (workingCounts.get(key) ?? 0) + 1);
    }
    const duplicateCount = [...workingCounts.values()].filter((n) => n > 1).length;

    setAlerts((prev) => ({ ...prev, workingOrders: workingOrders.length > 0 ? !hasWarning : null, duplicateOrders: duplicateCount }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workingOrders, levelsSummary, activeAccount?.settings.orderWarnBelow, activeAccount?.settings.orderBuffer]);

  useEffect(() => {
    if (!levelsSummary) {
      setAlerts((prev) => ({ ...prev, levelMatch: null }));
      return;
    }
    const totalLevelShares = levelsSummary.ownedLevels.reduce((sum, l) => sum + l.shares, 0);
    const match = tqqqShares > 0 && totalLevelShares > 0
      ? tqqqShares === totalLevelShares
      : null;
    setAlerts((prev) => ({ ...prev, levelMatch: match }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levelsSummary, tqqqShares]);

  useEffect(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const expiring = optionPositions.filter((p) => {
      const dte = Math.round((new Date(p.expiry + "T00:00:00").getTime() - today.getTime()) / 86400000);
      return dte === 0;
    }).length;

    const itm = quote.loading ? null : optionPositions.filter((p) => {
      if (p.putCall === "CALL") return p.strike < quote.price;
      return p.strike > quote.price;
    }).length;

    setAlerts((prev) => ({
      ...prev,
      expiringOptions: expiring,
      itmOptions: itm,
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionPositions, quote.price, quote.loading]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/quote");
        const data = await res.json();
        if (!cancelled && data.price != null)
          setQuote({ price: data.price, changePercent: data.changePercent, loading: false });
      } catch {
        if (!cancelled) setQuote((q) => ({ ...q, loading: false }));
      }
    }
    load();
    return () => { cancelled = true; };
  }, [refreshTick, setQuote]);

  const mainBg = activeAccount
    ? computedColorScheme === "dark"
      ? `linear-gradient(135deg, color-mix(in srgb, var(--mantine-color-${activeAccount.color}-7) 10%, var(--mantine-color-dark-9)) 0%, var(--mantine-color-dark-8) 100%)`
      : `linear-gradient(135deg, var(--mantine-color-${activeAccount.color}-1) 0%, var(--mantine-color-gray-1) 100%)`
    : undefined;

  return (
    <AppShell
      header={{ height: { base: 88, sm: 56 } }}
      navbar={isMobile ? undefined : { width: NAVBAR_WIDTH, breakpoint: 0 }}
      padding="md"
    >
      <AppShell.Header>
        <AppHeader
          onRefresh={tickRefresh}
          onSettingsOpen={() => setSettingsOpen(true)}
        />
      </AppShell.Header>

      {!isMobile && (
        <AppShell.Navbar>
          <SideNav />
        </AppShell.Navbar>
      )}

      <AppShell.Main style={{ background: mainBg, minHeight: "100vh", paddingBottom: isMobile ? 70 : undefined }}>
        <Box
          style={{
            position: "sticky",
            top: "var(--app-shell-header-height)",
            zIndex: 50,
            background: computedColorScheme === "dark" ? "rgba(0, 0, 0, 0.2)" : "rgba(255, 255, 255, 0.6)",
            marginInline: "calc(var(--mantine-spacing-md) * -1)",
            marginTop: "calc(var(--mantine-spacing-md) * -1)",
            padding: "var(--mantine-spacing-xs) var(--mantine-spacing-md)",
            marginBottom: "var(--mantine-spacing-md)",
          }}
        >
          <Box maw={1024} mx="auto">
            <AlertBar />
          </Box>
        </Box>
        <Box maw={1024} mx="auto">
          {children}
        </Box>
      </AppShell.Main>

      {isMobile && <BottomNav />}

      <SettingsModal opened={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </AppShell>
  );
}
