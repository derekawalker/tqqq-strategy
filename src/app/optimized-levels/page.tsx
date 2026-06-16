"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { Table, Text, Center, Stack, Group, Badge, Paper, Tooltip as MTooltip, Loader, SimpleGrid, ThemeIcon, Button } from "@mantine/core";
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";
import { IconPlayerPlayFilled, IconGauge, IconLock } from "@tabler/icons-react";
import { useMediaQuery } from "@mantine/hooks";
import { useApp } from "@/lib/context/AppContext";
import { useAccountColor } from "@/lib/hooks/useAccountColor";
import { useLevels } from "@/lib/hooks/useLevels";
import { buildMergedLadder } from "@/lib/adaptiveLevels";
import { OrderQueue, type QueueItem } from "@/components/OrderQueue";
import type { RegimeData } from "@/app/api/regime/route";
import { fmt, createMask } from "@/lib/format";

const REGIME_META: Record<RegimeData["regime"], { label: string; color: string; blurb: string }> = {
  "risk-on": { label: "Risk-on", color: "teal", blurb: "QQQ above its 200-day average — deploy the grid." },
  neutral: { label: "Neutral", color: "yellow", blurb: "QQQ near its 200-day average — proceed normally." },
  "risk-off": { label: "Risk-off", color: "red", blurb: "QQQ below its 200-day average — buy spacing widened to slow deployment." },
};

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <Stack gap={2}>
      <Text size="xs" c="dimmed">{label}</Text>
      <Text size="lg" fw={700} c={color}>{value}</Text>
      {sub && <Text size="xs" c="dimmed">{sub}</Text>}
    </Stack>
  );
}

function ChartTooltip({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <Paper p="xs" withBorder>
      {rows.map((r) => (
        <Text key={r.label} size="xs" c="dimmed">{r.label}: <Text span fw={700} c="bright">{r.value}</Text></Text>
      ))}
    </Paper>
  );
}

interface PendingOrder { side: "BUY" | "SELL"; shares: number; price: number; level: number }

export default function OptimizedLevelsPage() {
  const isMobile = useMediaQuery("(max-width: 768px)");
  const { activeAccount, privacyMode, quote, tickRefresh, workingOrders } = useApp();
  const accountColor = useAccountColor();
  const settings = activeAccount?.settings;
  const mask = createMask(privacyMode);
  const isTastytrade = activeAccount?.broker === "tastytrade";
  const summary = useLevels();

  const [regime, setRegime] = useState<RegimeData | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Order queue (tastytrade only) — same queue-then-submit flow + endpoint as the working-orders page.
  const [queue, setQueue] = useState<PendingOrder[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<{ ok: boolean; message: string }[] | null>(null);

  const isQueued = (side: "BUY" | "SELL", level: number) =>
    queue.some((o) => o.side === side && o.level === level);
  const toggleQueue = (o: PendingOrder) =>
    setQueue((prev) =>
      isQueued(o.side, o.level)
        ? prev.filter((q) => !(q.side === o.side && q.level === o.level))
        : [...prev, o],
    );
  const removeFromQueue = (i: number) => setQueue((prev) => prev.filter((_, k) => k !== i));
  const clearQueue = () => { setQueue([]); setResults(null); };

  const submitQueue = async () => {
    if (!activeAccount || queue.length === 0) return;
    setSubmitting(true);
    setResults(null);
    const out: { ok: boolean; message: string }[] = [];
    for (const o of queue) {
      try {
        const res = await fetch("/api/tastytrade/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountNumber: activeAccount.accountNumber, side: o.side, shares: o.shares, price: o.price }),
        });
        const json = await res.json();
        if (res.ok) {
          out.push({ ok: true, message: `${o.side} ${o.shares} @ $${fmt(o.price)}${json.sandbox ? " (sandbox)" : ""}` });
        } else {
          const raw = json?.error?.errors?.[0]?.message ?? json?.error?.message ?? json?.error?.error ?? json?.error;
          out.push({ ok: false, message: `L${o.level} ${o.side}: ${typeof raw === "string" ? raw : JSON.stringify(raw)}` });
        }
      } catch {
        out.push({ ok: false, message: `L${o.level} ${o.side}: Network error` });
      }
    }
    setResults(out);
    if (out.some((r) => r.ok)) tickRefresh();
    // Keep any failures queued for retry; drop the ones that placed.
    setQueue((prev) => prev.filter((_, i) => !out[i]?.ok));
    setSubmitting(false);
  };

  const baseSell = settings?.sellPercentage ?? 5;
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/regime?baseSell=${baseSell}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled && !d.error) setRegime(d as RegimeData); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [baseSell]);

  const configured =
    settings?.levelStartingCash != null &&
    settings?.initialLotPrice != null &&
    settings?.reductionFactor != null;

  // Owned levels (at/below the current level) keep their static numbers; rungs below go adaptive.
  const currentLevel = summary?.currentLevel ?? -1;
  const staticLevels = summary?.levels;
  const levels = useMemo(() => {
    if (!configured || !regime || !settings) return [];
    return buildMergedLadder(staticLevels ?? [], currentLevel, {
      levelStartingCash: settings.levelStartingCash!,
      initialLotPrice: settings.initialLotPrice!,
      reductionFactor: settings.reductionFactor!,
      spacingPercent: regime.suggestedSpacing,
      sellPercent: regime.suggestedSell,
    });
  }, [configured, regime, settings, staticLevels, currentLevel]);

  const queueItems: QueueItem[] = queue.map((o, i) => ({
    key: `${o.side}-${o.level}`,
    type: "place",
    side: o.side,
    shares: o.shares,
    price: o.price,
    onRemove: () => removeFromQueue(i),
  }));

  // Match a resting working order to a ladder row by side + share count (the stable anchor —
  // share counts don't move for owned rows the way the adaptive prices do). Closest limit price
  // breaks ties when two levels share a share count.
  const findOpenOrder = (side: "BUY" | "SELL", shares: number, refPrice: number) => {
    const cands = workingOrders.filter((o) => o.side === side && o.shares === shares);
    if (cands.length === 0) return null;
    return cands.reduce((best, o) =>
      Math.abs(o.limitPrice - refPrice) < Math.abs(best.limitPrice - refPrice) ? o : best);
  };

  if (!configured) {
    return (
      <Center h={200}>
        <Text c="dimmed" size="sm" ta="center">
          Configure account settings (starting cash, lot price, reduction factor)<br />to see optimized levels.
        </Text>
      </Center>
    );
  }

  const meta = regime ? REGIME_META[regime.regime] : null;
  const riskOff = regime?.regime === "risk-off";
  const rc = meta?.color ?? "gray";

  return (
    <Stack gap="md" pb={isMobile ? 80 : 24}>
      <Text fw={700} size="xl">Optimized Levels</Text>

      {/* Regime status panel — tinted by regime so risk state is unmissable */}
      <Paper
        p={isMobile ? "sm" : "md"}
        withBorder
        style={{
          background: meta ? `color-mix(in srgb, var(--mantine-color-${rc}-9) 22%, var(--mantine-color-dark-7))` : undefined,
          borderColor: meta ? `var(--mantine-color-${rc}-6)` : undefined,
        }}
      >
        {!loaded && !regime ? (
          <Center h={80}><Loader size="sm" /></Center>
        ) : regime && meta ? (
          <Stack gap="md">
            <Group justify="space-between" align="center" wrap="nowrap">
              <Group gap="sm" wrap="nowrap">
                <ThemeIcon color={rc} variant="light" size={isMobile ? "lg" : "xl"} radius="xl">
                  <IconGauge size={isMobile ? 22 : 26} />
                </ThemeIcon>
                <div>
                  <Text fw={800} size={isMobile ? "lg" : "xl"} c={`${rc}.3`}>{meta.label}</Text>
                  <Text size="xs" c="dimmed">{meta.blurb}</Text>
                </div>
              </Group>
              <Badge size={isMobile ? "md" : "lg"} color={rc} variant="filled" radius="sm">
                {`QQQ ${regime.pctVsSma >= 0 ? "+" : ""}${fmt(regime.pctVsSma, 1)}%`}
              </Badge>
            </Group>

            <SimpleGrid cols={isMobile ? 2 : 4} spacing="md">
              <Stat
                label="QQQ vs 200-DMA"
                value={`${regime.pctVsSma >= 0 ? "+" : ""}${fmt(regime.pctVsSma, 1)}%`}
                sub={`$${fmt(regime.qqqPrice, 0)} / $${fmt(regime.sma200, 0)}`}
                color={regime.pctVsSma >= 0 ? "teal" : "red"}
              />
              <Stat
                label="TQQQ vol (20d)"
                value={`${fmt(regime.realizedVol, 0)}%`}
                sub={`baseline ${fmt(regime.baselineVol, 0)}%`}
                color={regime.realizedVol > regime.baselineVol ? "orange" : "teal"}
              />
              <Stat label="Suggested spacing" value={`${fmt(regime.suggestedSpacing, 2)}%`} sub="static grid: 1.00%" />
              <Stat label="Suggested sell" value={`${fmt(regime.suggestedSell, 2)}%`} sub={`your target: ${fmt(baseSell, 2)}%`} />
            </SimpleGrid>

            <SimpleGrid cols={isMobile ? 1 : 2} spacing="md">
              {/* QQQ vs 200-DMA */}
              <div>
                <Text size="xs" c="dimmed" mb={4}>QQQ vs 200-DMA</Text>
                <ResponsiveContainer width="100%" height={150}>
                  <LineChart data={regime.qqqSeries} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--mantine-color-dark-4)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--mantine-color-gray-5)" }} tickLine={false} minTickGap={36} />
                    <YAxis domain={["auto", "auto"]} width={42} axisLine={false} tickLine={false}
                      tick={{ fontSize: 10, fill: "var(--mantine-color-gray-5)" }} tickFormatter={(v: number) => `$${fmt(v, 0)}`} />
                    <Tooltip content={({ active, payload }) => {
                      if (!active || !payload?.[0]) return null;
                      const p = payload[0].payload as { date: string; price: number; sma200: number };
                      return <ChartTooltip rows={[
                        { label: p.date, value: "" },
                        { label: "QQQ", value: `$${fmt(p.price, 0)}` },
                        { label: "200-DMA", value: `$${fmt(p.sma200, 0)}` },
                      ]} />;
                    }} />
                    <Line type="monotone" dataKey="price" stroke={`var(--mantine-color-${rc}-5)`} strokeWidth={1.75} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="sma200" stroke="var(--mantine-color-gray-5)" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* TQQQ 20-day volatility */}
              <div>
                <Text size="xs" c="dimmed" mb={4}>TQQQ 20-day volatility</Text>
                <ResponsiveContainer width="100%" height={150}>
                  <AreaChart data={regime.volSeries} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--mantine-color-orange-5)" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="var(--mantine-color-orange-5)" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--mantine-color-dark-4)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--mantine-color-gray-5)" }} tickLine={false} minTickGap={36} />
                    <YAxis domain={["auto", "auto"]} width={36} axisLine={false} tickLine={false}
                      tick={{ fontSize: 10, fill: "var(--mantine-color-gray-5)" }} tickFormatter={(v: number) => `${fmt(v, 0)}%`} />
                    <Tooltip content={({ active, payload }) => {
                      if (!active || !payload?.[0]) return null;
                      const p = payload[0].payload as { date: string; vol: number };
                      return <ChartTooltip rows={[{ label: p.date, value: "" }, { label: "20d vol", value: `${fmt(p.vol, 0)}%` }]} />;
                    }} />
                    <ReferenceLine y={regime.baselineVol} stroke="var(--mantine-color-gray-6)" strokeDasharray="4 3" />
                    <Area type="monotone" dataKey="vol" stroke="var(--mantine-color-orange-5)" strokeWidth={1.5} fill="url(#volGrad)" dot={false} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </SimpleGrid>

            <Text size="xs" c="dimmed">
              Advisory: rungs are spaced geometrically and rescale with volatility. Read-only — this
              doesn&apos;t affect your tracked positions or the Levels page.
              {riskOff && ` Risk-off — buy spacing widened to ${fmt(regime.suggestedSpacing, 2)}% to deploy into the drawdown more slowly.`}
            </Text>
          </Stack>
        ) : (
          <Text size="sm" c="dimmed">Couldn&apos;t load market data — try refreshing.</Text>
        )}
      </Paper>

      {levels.length > 0 && (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Level</Table.Th>
              <Table.Th>Buy Price</Table.Th>
              <Table.Th>Sell Price</Table.Th>
              <Table.Th>Shares</Table.Th>
              {!isMobile && <Table.Th>Cost</Table.Th>}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {levels.map(({ n, buyPrice, sellPrice, shares, cost, optimized }) => {
              const inRange = !quote.loading && quote.price >= buyPrice && quote.price <= sellPrice;
              const openBuy = isTastytrade ? findOpenOrder("BUY", shares, buyPrice) : null;
              const openSell = isTastytrade ? findOpenOrder("SELL", shares, sellPrice) : null;
              return (
                <Fragment key={n}>
                  <Table.Tr
                    style={{
                      background: inRange
                        ? `color-mix(in srgb, var(--mantine-color-${accountColor}-7) 8%, transparent)`
                        : undefined,
                    }}
                  >
                    <Table.Td style={{ position: "relative" }}>
                      {inRange && (
                        <MTooltip label="Current price" withArrow>
                          <IconPlayerPlayFilled
                            size={10}
                            color={`var(--mantine-color-${accountColor}-5)`}
                            style={{ position: "absolute", left: -6, top: "50%", transform: "translateY(-50%)" }}
                          />
                        </MTooltip>
                      )}
                      <Group gap={6} wrap="nowrap">
                        <Text size="sm">{n}</Text>
                        {optimized
                          ? <Badge size="xs" color={rc} variant="light">opt</Badge>
                          : <MTooltip label="Owned — static numbers" withArrow><Badge size="xs" color="gray" variant="light">held</Badge></MTooltip>}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={8} wrap="nowrap" justify="space-between">
                        <Text size="sm">{mask(`$${fmt(openBuy ? openBuy.limitPrice : buyPrice)}`)}</Text>
                        {openBuy ? (
                          <MTooltip label={`Open BUY order · ${mask(fmt(openBuy.shares, 0))} sh`} withArrow>
                            <Badge size="xs" color="teal" variant="light" leftSection={<IconLock size={9} />}>open</Badge>
                          </MTooltip>
                        ) : isTastytrade && optimized ? (
                          <Button size="compact-xs" color="teal" variant={isQueued("BUY", n) ? "filled" : "light"}
                            onClick={() => toggleQueue({ side: "BUY", shares, price: buyPrice, level: n })}>
                            {isQueued("BUY", n) ? "Queued" : "Buy"}
                          </Button>
                        ) : null}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={8} wrap="nowrap" justify="space-between">
                        <Text size="sm">{mask(`$${fmt(openSell ? openSell.limitPrice : sellPrice)}`)}</Text>
                        {openSell ? (
                          <MTooltip label={`Open SELL order · ${mask(fmt(openSell.shares, 0))} sh`} withArrow>
                            <Badge size="xs" color="red" variant="light" leftSection={<IconLock size={9} />}>open</Badge>
                          </MTooltip>
                        ) : isTastytrade && !optimized ? (
                          <Button size="compact-xs" color="red" variant={isQueued("SELL", n) ? "filled" : "light"}
                            onClick={() => toggleQueue({ side: "SELL", shares, price: sellPrice, level: n })}>
                            {isQueued("SELL", n) ? "Queued" : "Sell"}
                          </Button>
                        ) : null}
                      </Group>
                    </Table.Td>
                    <Table.Td>{mask(fmt(shares, 0))}</Table.Td>
                    {!isMobile && <Table.Td>{mask(`$${fmt(cost)}`)}</Table.Td>}
                  </Table.Tr>
                </Fragment>
              );
            })}
          </Table.Tbody>
        </Table>
      )}

      {isTastytrade && (
        <OrderQueue
          items={queueItems}
          onClear={clearQueue}
          onSubmit={submitQueue}
          submitting={submitting}
          failures={results?.filter((r) => !r.ok).map((r) => r.message) ?? []}
        />
      )}
    </Stack>
  );
}
