"use client";

import { useState, useEffect, ReactNode } from "react";
import { AppShell, Box, useComputedColorScheme } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import AppHeader from "@/components/AppHeader";
import AlertBar from "@/components/AlertBar";
import SettingsModal from "@/components/SettingsModal";
import { SideNav, BottomNav } from "@/components/AppNav";
import { useApp } from "@/lib/context/AppContext";

const NAVBAR_WIDTH = 180;

export default function AppShellLayout({ children }: { children: ReactNode }) {
  const { activeAccount, setQuote, refreshTick, tickRefresh } = useApp();
  const computedColorScheme = useComputedColorScheme("dark");
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [settingsOpen, setSettingsOpen] = useState(false);

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
        <Box mb="md">
          <AlertBar />
        </Box>
        {children}
      </AppShell.Main>

      {isMobile && <BottomNav />}

      <SettingsModal opened={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </AppShell>
  );
}
