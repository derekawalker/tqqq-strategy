"use client";

import { useState, useEffect } from "react";
import { Paper, Skeleton, Text, Center } from "@mantine/core";
import { ResponsiveContainer, AreaChart, Area, Customized, YAxis, ReferenceLine, Tooltip } from "recharts";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/context/AppContext";
import { useLevels } from "@/lib/hooks/useLevels";
import { useCardBg } from "@/lib/hooks/useCardBg";
import { CARD_RADIUS } from "@/lib/cardStyles";
import type { Candle } from "@/app/api/chart/route";

let miniCache: { tick: number; data: Candle[] } | null = null;

function CenterLabel({ viewBox, value, color, bg }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  viewBox?: any; value: string; color: string; bg: string;
}) {
  if (!viewBox) return null;
  const cx = viewBox.x + viewBox.width / 2;
  const cy = viewBox.y;
  const w = value.length * 6 + 10;
  const h = 14;
  return (
    <g>
      <rect x={cx - w / 2} y={cy - h / 2} width={w} height={h} rx={3} fill={bg} opacity={0.85} />
      <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle" fontSize={9} fontWeight={600} fill={color}>
        {value}
      </text>
    </g>
  );
}

export function MiniChartCard() {
  const { quoteTick, activeAccount, quote } = useApp();
  const router = useRouter();
  const levelsSummary = useLevels();
  const color = activeAccount?.color ?? "dark";

  const [fetchedData, setFetchedData] = useState<{ tick: number; data: Candle[] } | null>(null);

  const candles: Candle[] = (miniCache?.tick === quoteTick ? miniCache.data : null)
    ?? (fetchedData?.tick === quoteTick ? fetchedData.data : null)
    ?? [];
  const loading = candles.length === 0 && miniCache?.tick !== quoteTick && fetchedData?.tick !== quoteTick;

  useEffect(() => {
    if (miniCache?.tick === quoteTick) return;
    let cancelled = false;
    fetch("/api/chart?range=1d")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && Array.isArray(data)) {
          miniCache = { tick: quoteTick, data };
          setFetchedData({ tick: quoteTick, data });
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [quoteTick]);

  const bg = useCardBg(color);

  if (loading) {
    return (
      <Paper p={0} radius={CARD_RADIUS} style={{ overflow: "hidden", background: bg, height: "100%" }}>
        <Skeleton height={140} radius="md" />
      </Paper>
    );
  }

  if (candles.length === 0) {
    return (
      <Paper p={0} radius={CARD_RADIUS} onClick={() => router.push("/chart")} style={{ overflow: "hidden", background: bg, cursor: "pointer", height: "100%" }}>
        <Center h={140}>
          <Text size="sm" c="dimmed">Markets closed</Text>
        </Center>
      </Paper>
    );
  }

  const prices = candles.map((c) => c.close);
  const currentLevel = levelsSummary?.currentLevel ?? -1;
  const levels = levelsSummary?.levels ?? [];
  const currentSellPrice = currentLevel >= 0 ? levels[currentLevel]?.sellPrice ?? null : null;
  const nextBuyPrice = currentLevel >= 0 && currentLevel + 1 < levels.length
    ? levels[currentLevel + 1]?.buyPrice ?? null : null;
  const currentPrice = quote.loading ? null : quote.price;

  const allPrices = [...prices];
  if (currentPrice) allPrices.push(currentPrice);
  if (currentSellPrice) allPrices.push(currentSellPrice);
  if (nextBuyPrice) allPrices.push(nextBuyPrice);

  const min = allPrices.length ? Math.min(...allPrices) : 0;
  const max = allPrices.length ? Math.max(...allPrices) : 100;
  const pad = (max - min) * 0.1;

  return (
    <Paper
      p={0}
      radius={CARD_RADIUS}
      onClick={() => router.push("/chart")}
      style={{ overflow: "hidden", background: bg, cursor: "pointer", height: "100%" }}
    >
      <ResponsiveContainer width="100%" height={140}>
        <AreaChart data={candles} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
          <Customized component={() => (
            <defs>
              <linearGradient id="miniLineGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--mantine-color-lime-6)" />
                <stop offset="100%" stopColor="var(--mantine-color-indigo-5)" />
              </linearGradient>
              <linearGradient id="miniAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--mantine-color-lime-6)" stopOpacity={0.25} />
                <stop offset="100%" stopColor="var(--mantine-color-indigo-5)" stopOpacity={0.03} />
              </linearGradient>
            </defs>
          )} />
          <YAxis domain={[min - pad, max + pad]} hide />
          <Tooltip
            cursor={{ stroke: "rgba(255,255,255,0.15)", strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload?.[0]) return null;
              const d = payload[0].payload as Candle;
              const time = new Date(d.time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
              return (
                <Paper p="xs" style={{ background: "var(--mantine-color-dark-7)" }}>
                  <Text size="xs" c="dimmed">{time}</Text>
                  <Text size="xs" fw={700}>${d.close.toFixed(2)}</Text>
                </Paper>
              );
            }}
          />

          <Area
            type="monotone"
            dataKey="close"
            stroke="url(#miniLineGrad)"
            strokeWidth={2.5}
            fill="url(#miniAreaGrad)"
            dot={false}
            isAnimationActive={false}
          />

          {currentPrice && (
            <ReferenceLine y={currentPrice} stroke="rgba(255,255,255,0.5)" strokeWidth={1}
              label={<CenterLabel value={`$${currentPrice.toFixed(2)}`} color="#fff" bg="rgba(80,80,80,0.9)" />} />
          )}
          {currentSellPrice && (
            <ReferenceLine y={currentSellPrice} stroke="var(--mantine-color-lime-6)" strokeDasharray="4 3" strokeWidth={1}
              label={<CenterLabel value={`$${currentSellPrice.toFixed(2)}`} color="#fff" bg="rgba(130,180,50,0.85)" />} />
          )}
          {nextBuyPrice && (
            <ReferenceLine y={nextBuyPrice} stroke="var(--mantine-color-indigo-5)" strokeDasharray="4 3" strokeWidth={1}
              label={<CenterLabel value={`$${nextBuyPrice.toFixed(2)}`} color="#fff" bg="rgba(80,80,200,0.85)" />} />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </Paper>
  );
}
