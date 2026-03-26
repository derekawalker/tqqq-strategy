"use client";

import { useMemo } from "react";
import { Box } from "@mantine/core";
import { useApp } from "@/lib/context/AppContext";
import { AccountValueCard } from "@/components/AccountValueCard";
import { GainLossCard } from "@/components/GainLossCard";
import { StatCard } from "@/components/StatCard";
import { MiniChartCard } from "@/components/MiniChartCard";
import { CurrentLevelCard } from "@/components/CurrentLevelCard";

export default function Home() {
  const { filledOrders, optionPositions, activeAccount, tqqqShares } = useApp();
  const color = activeAccount?.color ?? "dark";

  const tradesToday = useMemo(() => {
    const today = new Date().toLocaleDateString("en-CA");
    return filledOrders.filter((o) => {
      const d = new Date(o.time).toLocaleDateString("en-CA");
      return d === today;
    }).length;
  }, [filledOrders]);


  return (
    <Box className="dashboard-grid">
      <div className="dash-account"><AccountValueCard /></div>
      <div className="dash-gainloss"><GainLossCard /></div>
      <div className="dash-stats">
        <StatCard color={color} label="Trades Today" value={tradesToday} href="/filled-orders" />
        <StatCard color={color} label="Open Options" value={optionPositions.length} href="/options" />
        <StatCard color={color} label="TQQQ Shares" value={tqqqShares.toLocaleString()} />
      </div>
      <div className="dash-chart"><MiniChartCard /></div>
      <div className="dash-level"><CurrentLevelCard /></div>
    </Box>
  );
}
