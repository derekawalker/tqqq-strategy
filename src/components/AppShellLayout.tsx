"use client";

import { useState, useEffect, ReactNode } from "react";
import { AppShell, Box } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { usePathname } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { PageAlertBanner } from "@/components/PageAlertBanner";
import SettingsModal from "@/components/SettingsModal";
import { SideNav, BottomNav } from "@/components/AppNav";
import { useApp } from "@/lib/context/AppContext";
import { useLevels } from "@/lib/hooks/useLevels";
import { usePendingBuyCost } from "@/lib/hooks/usePendingBuyCost";
import { useCSPCollateral } from "@/lib/hooks/useCSPCollateral";

const NAVBAR_WIDTH = 180;

function AppShellInner({ children }: { children: ReactNode }) {
  const { activeAccount, setQuote, refreshTick, quoteTick, tickRefresh, tqqqShares, setAlerts, workingOrders, optionPositions, quote, balances } = useApp();
  const levelsSummary = useLevels();
  const pendingBuyCost = usePendingBuyCost();
  const cspCollateral = useCSPCollateral();
  const isMobile = useMediaQuery("(max-width: 768px)", false);
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
    if (!activeAccount) return;
    const balance = balances.find((b) => b.accountNumber === activeAccount.accountNumber);
    if (!balance) {
      setAlerts((prev) => ({ ...prev, idleCash: null }));
      return;
    }

    const idleCash = balance.cash - (cspCollateral ?? 0) - (pendingBuyCost ?? 0);
    setAlerts((prev) => ({ ...prev, idleCash: idleCash > 1000 ? idleCash : null }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balances, activeAccount?.accountNumber, cspCollateral, pendingBuyCost]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const quotePromise = fetch("/api/quote").then((r) => r.json()).catch(() => null);
      const trendPromise = fetch("/api/trend").then((r) => r.json()).catch(() => null);

      // Set price immediately when quote resolves — don't wait for trend
      const quoteData = await quotePromise;
      if (!cancelled && quoteData?.price != null)
        setQuote((q) => ({ ...q, price: quoteData.price, changePercent: quoteData.changePercent, trend: 0, loading: false }));
      else if (!cancelled)
        setQuote((q) => ({ ...q, loading: false }));

      // Update trend when it arrives (already in-flight)
      const trendData = await trendPromise;
      if (!cancelled && trendData?.trend != null)
        setQuote((q) => ({ ...q, trend: trendData.trend, closes30: trendData.closes30 ?? [], dates30: trendData.dates30 ?? [], daysOfWeek30: trendData.daysOfWeek30 ?? [] }));
    }
    load();
    return () => { cancelled = true; };
  }, [refreshTick, quoteTick, setQuote]);

  const mainBg = activeAccount
    ? `linear-gradient(135deg, color-mix(in srgb, var(--mantine-color-${activeAccount.color}-7) 10%, var(--mantine-color-dark-9)) 0%, var(--mantine-color-dark-8) 100%)`
    : undefined;

  return (
    <AppShell
      header={{ height: { base: 88, sm: 56 } }}
      navbar={{ width: NAVBAR_WIDTH, breakpoint: "sm", collapsed: { mobile: true } }}
      padding="md"
    >
      <AppShell.Header>
        <AppHeader
          onRefresh={tickRefresh}
          onSettingsOpen={() => setSettingsOpen(true)}
        />
      </AppShell.Header>

      <AppShell.Navbar>
        <SideNav />
      </AppShell.Navbar>

      <AppShell.Main style={{ background: mainBg, minHeight: "100vh", paddingBottom: isMobile ? 70 : undefined }}>
        <Box maw={1024} mx="auto">
          <PageAlertBanner />
          {children}
        </Box>
      </AppShell.Main>

      {isMobile && <BottomNav />}

      <SettingsModal opened={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </AppShell>
  );
}

export default function AppShellLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/login") return <>{children}</>;
  return <AppShellInner>{children}</AppShellInner>;
}
