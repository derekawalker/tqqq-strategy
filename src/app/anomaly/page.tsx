"use client";

import { useState, useEffect, useMemo } from "react";
import { useMediaQuery } from "@mantine/hooks";
import {
  Paper,
  Stack,
  Text,
  Group,
  Box,
  Skeleton,
  SegmentedControl,
  Center,
  SimpleGrid,
  Accordion,
  List,
  Button,
} from "@mantine/core";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import { CARD_RADIUS } from "@/lib/cardStyles";
import {
  CRASH_ENTER,
  CRASH_EXIT,
  BOOM_EUPHORIA_ENTER,
  DEFAULT_PARAMS,
  type AnomalyPoint,
} from "@/lib/anomaly";
import { DEEP_BUY_Z } from "@/lib/backtest";
import { dailyAdvice, DEFAULT_ADVICE, type AdvicePoint } from "@/lib/advice";
import { buyThrottle, throttleSpans, type ThrottleMode, type ThrottlePoint } from "@/lib/throttle";
import { simulateLadder, DEFAULT_LADDER, type LadderParams } from "@/lib/ladderSim";
import { useApp } from "@/lib/context/AppContext";

interface AnomalyResponse {
  points: AnomalyPoint[];
  tqqq: { date: string; close: number; high: number; low: number }[];
  asOf: string | null;
  components: Record<string, string>;
}

/** Minimal shape of the recharts mouse-event state we read for drag-to-zoom. */
type ChartMouse = { activeLabel?: string | number } | null;

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y.slice(2)}`;
}

const RANGE_MONTHS: Record<string, number | null> = {
  "3m": 3,
  "6m": 6,
  "1y": 12,
  "2y": 24,
  "5y": 60,
  "10y": 120,
  "max": null,
};

/** ISO cutoff date for a display range, or null for "max" (all data). */
function cutoffISO(range: string): string | null {
  const m = RANGE_MONTHS[range];
  if (m == null) return null;
  const d = new Date();
  d.setMonth(d.getMonth() - m);
  return d.toISOString().slice(0, 10);
}

// --- At-a-glance market read ------------------------------------------------
// Plain-language tiles that map straight to the ladder decision, instead of an
// abstract 0–100 fear/greed score.

/** Crash-risk word from the fragility z-score (what drives the throttle/pause). */
function crashRisk(frag: number | null): { label: string; color: string } {
  if (frag == null) return { label: "—", color: "gray" };
  if (frag >= 3) return { label: "Crash", color: "red" };
  if (frag >= 2) return { label: "High", color: "orange" };
  if (frag >= 1) return { label: "Elevated", color: "yellow" };
  return { label: "Calm", color: "green" };
}

/** Color for a drawdown-from-high (a negative fraction). */
function ddColor(dd: number): string {
  if (dd > -0.05) return "green";
  if (dd > -0.1) return "yellow";
  if (dd > -0.2) return "orange";
  return "red";
}

interface ReadTile {
  label: string;
  value: string;
  sub: string;
  color: string;
}

/** Build the four market-read tiles from today's readings. */
function buildReadTiles(
  today: AdvicePoint | null,
  latest: AnomalyPoint | null,
  bottomZone: boolean,
  dd52: number,
): ReadTile[] {
  if (!today || !latest) return [];
  const trendPct = today.ma ? (today.spx - today.ma) / today.ma : null;
  const cr = crashRisk(latest.fragility);
  return [
    {
      label: "Trend",
      value: trendPct == null ? "—" : trendPct >= 0 ? "Above" : "Below",
      sub: trendPct == null ? "200-day" : `${fmtSignedPct(trendPct)} vs 200-day`,
      color: trendPct == null ? "gray" : trendPct >= 0 ? "green" : "red",
    },
    { label: "Pullback", value: fmtSignedPct(dd52), sub: "from 1-yr high", color: ddColor(dd52) },
    {
      label: "Crash risk",
      value: cr.label,
      sub: `fragility ${latest.fragility?.toFixed(1) ?? "—"}`,
      color: cr.color,
    },
    {
      label: "Buy zone",
      value: bottomZone ? "YES" : "No",
      sub: bottomZone ? "capitulation" : "not extreme",
      color: bottomZone ? "teal" : "gray",
    },
  ];
}

/** Compact 2×2 grid of plain-language market-read tiles. */
function MarketRead({ tiles }: { tiles: ReadTile[] }) {
  return (
    <SimpleGrid cols={2} spacing="xs" w="100%">
      {tiles.map((t) => (
        <Box
          key={t.label}
          px="sm"
          py={8}
          style={{ borderRadius: 10, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
        >
          <Text size="10px" tt="uppercase" c="gray.5" fw={600} style={{ letterSpacing: "0.08em" }}>
            {t.label}
          </Text>
          <Text size="xl" fw={800} c={`${t.color}.4`} lh={1.15}>
            {t.value}
          </Text>
          <Text size="10px" c="gray.6">
            {t.sub}
          </Text>
        </Box>
      ))}
    </SimpleGrid>
  );
}

function fmtUsd(x: number): string {
  return "$" + Math.round(x).toLocaleString("en-US");
}

function fmtSignedPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(0)}%`;
}

// --- Today's buy-side posture (you always keep your TQQQ) -------------------

/** Mantine color for today's buy posture. */
function postureColor(m: ThrottleMode): string {
  if (m === "redeploy") return "teal";
  if (m === "pause") return "red";
  if (m === "slow") return "yellow";
  return "green";
}

function postureHeadline(m: ThrottleMode): string {
  if (m === "redeploy") return "RESUME — BUY THE DIP BOTTOM";
  if (m === "pause") return "PAUSE NEW BUYS";
  if (m === "slow") return "SLOW DOWN — HALF-SIZE BUYS";
  return "BUY NORMALLY — FULL LADDER";
}

function postureReason(m: ThrottleMode): string {
  if (m === "redeploy") {
    return "Capitulation bottom confirmed (deep fear + price turning back up) — resume buying and deploy the dry powder you saved to catch the bounce.";
  }
  if (m === "pause") {
    return "Fragility spike — a bigger drop may be underway. Pause new buys so you don't spend your powder into a falling knife. You keep every share of TQQQ; buying resumes once the bottom is confirmed.";
  }
  if (m === "slow") {
    return "Stress is building — keep laddering but at half size, saving dry powder in case the dip deepens.";
  }
  return "No crash stress — run the TQQQ ladder normally, buying each dip level in full.";
}

/** Dark card tinted by the decision color, with gloss + shadow (matches useCardBg). */
function heroCardStyle(color: string) {
  const gloss = "linear-gradient(160deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 14%, rgba(255,255,255,0) 26%)";
  const base = `linear-gradient(135deg, color-mix(in srgb, var(--mantine-color-${color}-8) 35%, var(--mantine-color-dark-8)) 0%, var(--mantine-color-dark-8) 100%)`;
  return {
    background: `${gloss}, ${base}`,
    boxShadow: "0 8px 24px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.10)",
    border: "none",
  };
}

export default function AnomalyPage() {
  const isMobile = useMediaQuery("(max-width: 768px)") ?? false;
  const [range, setRange] = useState("5y"); // display window (the indicators always use full history)
  const { activeAccount } = useApp();
  const [result, setResult] = useState<{ data: AnomalyResponse | null; error: string | null } | null>(null);

  // Always fetch the full history so the z-scores / 200-day MA have warm-up; the
  // range toggle only filters what's displayed and backtested.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/anomaly?years=14`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setResult(d.error ? { data: null, error: d.error } : { data: d, error: null });
      })
      .catch((e) => !cancelled && setResult({ data: null, error: String(e) }));
    return () => {
      cancelled = true;
    };
  }, []);

  const data = result?.data ?? null;
  const error = result?.error ?? null;
  const loading = !result;
  const cutoff = cutoffISO(range);

  // Advice + indicators computed over the FULL history (need the warm-up).
  const fullPoints = useMemo(() => data?.points ?? [], [data]);
  const advice = useMemo(() => (fullPoints.length ? dailyAdvice(fullPoints) : []), [fullPoints]);
  const today = advice.at(-1) ?? null;
  const pointsAll = useMemo(() => fullPoints.filter((p) => p.composite != null), [fullPoints]);
  const latest = pointsAll.at(-1) ?? null; // gauge / today always reflect the latest reading

  // ---- Graded buy throttle: today's buy-side posture (you always hold TQQQ) ----
  const throttleFull = useMemo(() => buyThrottle(fullPoints), [fullPoints]);
  const throttleByDate = useMemo(
    () => new Map(fullPoints.map((p, i) => [p.date, throttleFull[i]?.rate ?? 1])),
    [fullPoints, throttleFull],
  );
  const todayThrottle: ThrottlePoint = throttleFull.at(-1) ?? { mode: "full", rate: 1 };
  const bottomZone = latest?.composite != null && latest.composite <= DEFAULT_ADVICE.capitulation;
  const lastPostureChange = useMemo(() => {
    let found: { date: string; mode: ThrottleMode } | null = null;
    for (let i = 1; i < throttleFull.length; i++) {
      if (throttleFull[i].mode !== throttleFull[i - 1].mode) {
        found = { date: fullPoints[i].date, mode: throttleFull[i].mode };
      }
    }
    return found;
  }, [throttleFull, fullPoints]);

  // Charts (price + oscillator) over the selected display window.
  const points = useMemo(() => (cutoff ? pointsAll.filter((p) => p.date >= cutoff) : pointsAll), [pointsAll, cutoff]);
  const maByDate = useMemo(() => new Map(advice.map((a) => [a.date, a.ma])), [advice]);
  const priceData = useMemo(
    () => points.map((p) => ({ date: p.date, spx: p.spx, ma: maByDate.get(p.date) ?? null })),
    [points, maByDate],
  );
  const spxDomain = useMemo((): [number, number] => {
    const v: number[] = [];
    for (const d of priceData) {
      v.push(d.spx);
      if (d.ma != null) v.push(d.ma);
    }
    if (v.length === 0) return [0, 100];
    const min = Math.min(...v);
    const max = Math.max(...v);
    const pad = (max - min) * 0.05;
    return [min - pad, max + pad];
  }, [priceData]);

  // Ladder params default to the active account's settings, overridable on-page.
  const ladderParams = useMemo<LadderParams>(() => {
    const s = activeAccount?.settings;
    const r = s?.reductionFactor && s.reductionFactor > 0 ? s.reductionFactor : DEFAULT_LADDER.reductionFactor;
    return {
      startingCash: s?.levelStartingCash && s.levelStartingCash > 0 ? s.levelStartingCash : 100000,
      stepPct: 1,
      sellPct: s?.sellPercentage || DEFAULT_LADDER.sellPct,
      reductionFactor: r,
      reanchorPct: 0,
    };
  }, [activeAccount]);

  const tqqqBars = useMemo(() => {
    const all = data?.tqqq ?? [];
    return cutoff ? all.filter((b) => b.date >= cutoff) : all;
  }, [data, cutoff]);
  // Per-bar buy rate (1 / 0.5 / 0) carried from the throttle onto the TQQQ bars.
  const ladderThrottle = useMemo(() => {
    const out: number[] = [];
    let last = 1;
    for (const b of tqqqBars) {
      const v = throttleByDate.get(b.date);
      if (v !== undefined) last = v;
      out.push(last);
    }
    return out;
  }, [tqqqBars, throttleByDate]);
  const ladder = useMemo(() => {
    if (tqqqBars.length < 2) return null;
    const base = simulateLadder(tqqqBars, ladderParams);
    const thr = simulateLadder(tqqqBars, ladderParams, ladderThrottle);
    const equity = base.equity.map((e, i) => ({ date: e.date, base: e.value, thr: thr.equity[i]?.value ?? e.value }));
    // Shading spans for paused (rate 0) and half (0 < rate < 1) days.
    const pausePts = tqqqBars.map((b) => ({ date: b.date }));
    const spansPause = throttleSpans(pausePts, ladderThrottle, (r) => r === 0);
    const spansHalf = throttleSpans(pausePts, ladderThrottle, (r) => r > 0 && r < 1);
    // Y-domain padded to the actual equity range so the chart isn't anchored at $0.
    let lo = Infinity;
    let hi = -Infinity;
    for (const e of equity) {
      lo = Math.min(lo, e.base, e.thr);
      hi = Math.max(hi, e.base, e.thr);
    }
    const pad = (hi - lo) * 0.08 || hi * 0.05;
    const domain: [number, number] = [Math.max(0, lo - pad), hi + pad];
    return { base, thr, equity, spansPause, spansHalf, domain };
  }, [tqqqBars, ladderThrottle, ladderParams]);

  const tickFormatter = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", year: "2-digit" });

  const postColor = postureColor(todayThrottle.mode);

  // ---- Drag-to-zoom: a shared date window applied to all charts ----
  const [zoom, setZoom] = useState<{ start: string; end: string } | null>(null);
  const [selL, setSelL] = useState<string | null>(null);
  const [selR, setSelR] = useState<string | null>(null);
  const onZoomDown = (e: ChartMouse) => {
    const l = e?.activeLabel;
    if (l != null) {
      setSelL(String(l));
      setSelR(String(l));
    }
  };
  const onZoomMove = (e: ChartMouse) => {
    if (selL != null && e?.activeLabel != null) setSelR(String(e.activeLabel));
  };
  const onZoomUp = () => {
    if (selL != null && selR != null && selL !== selR) {
      const [s, en] = [selL, selR].sort();
      setZoom({ start: s, end: en });
    }
    setSelL(null);
    setSelR(null);
  };
  const inZoom = (d: string) => !zoom || (d >= zoom.start && d <= zoom.end);
  const pointsV = useMemo(
    () => (zoom ? points.filter((p) => p.date >= zoom.start && p.date <= zoom.end) : points),
    [points, zoom],
  );
  const priceDataV = useMemo(
    () => (zoom ? priceData.filter((p) => p.date >= zoom.start && p.date <= zoom.end) : priceData),
    [priceData, zoom],
  );
  const spxDomainV = useMemo((): [number, number] => {
    const v: number[] = [];
    for (const d of priceDataV) {
      v.push(d.spx);
      if (d.ma != null) v.push(d.ma);
    }
    if (v.length === 0) return spxDomain;
    const min = Math.min(...v);
    const max = Math.max(...v);
    const pad = (max - min) * 0.05;
    return [min - pad, max + pad];
  }, [priceDataV, spxDomain]);
  const ladderView = useMemo(() => {
    if (!ladder) return null;
    const equity = zoom ? ladder.equity.filter((e) => e.date >= zoom.start && e.date <= zoom.end) : ladder.equity;
    let lo = Infinity;
    let hi = -Infinity;
    for (const e of equity) {
      lo = Math.min(lo, e.base, e.thr);
      hi = Math.max(hi, e.base, e.thr);
    }
    const pad = (hi - lo) * 0.08 || hi * 0.05;
    const domain: [number, number] = equity.length ? [Math.max(0, lo - pad), hi + pad] : ladder.domain;
    return { equity, domain };
  }, [ladder, zoom]);

  // At-a-glance market read tiles (trend, pullback, crash risk, buy zone).
  const dd52 = useMemo(() => {
    const n = fullPoints.length;
    if (n === 0) return 0;
    const start = Math.max(0, n - 252);
    let hiP = -Infinity;
    for (let i = start; i < n; i++) hiP = Math.max(hiP, fullPoints[i].spx);
    const last = fullPoints[n - 1].spx;
    return hiP > 0 ? (last - hiP) / hiP : 0;
  }, [fullPoints]);
  const readTiles: ReadTile[] = buildReadTiles(today, latest, bottomZone, dd52);

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center">
        <Text fw={700} size="xl">
          Anomaly Radar
        </Text>
        <Group gap="xs" align="center">
          {zoom && (
            <Button size="compact-xs" variant="light" color="gray" onClick={() => setZoom(null)}>
              Reset zoom
            </Button>
          )}
          <SegmentedControl
            size="xs"
            value={range}
            onChange={(v) => {
              setRange(v);
              setZoom(null);
            }}
            data={[
              { label: "3M", value: "3m" },
              { label: "6M", value: "6m" },
              { label: "1Y", value: "1y" },
              { label: "2Y", value: "2y" },
              { label: "5Y", value: "5y" },
              { label: "10Y", value: "10y" },
              { label: "Max", value: "max" },
            ]}
          />
        </Group>
      </Group>

      {error && (
        <Paper p="md" radius={CARD_RADIUS} bg="red.9">
          <Text c="white">Failed to load data: {error}</Text>
        </Paper>
      )}

      {loading ? (
        <Skeleton height={420} radius={CARD_RADIUS} />
      ) : latest && today ? (
        <>
          {/* ---- Hero: today's buy-side posture (you always hold TQQQ) ---- */}
          <Paper p="lg" radius={CARD_RADIUS} style={heroCardStyle(postColor)}>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg" style={{ alignItems: "center" }}>
              <Center>
                <Stack gap={6} align="stretch" w="100%">
                  <Text size="xs" tt="uppercase" fw={600} c="gray.5" style={{ letterSpacing: "0.12em" }}>
                    Market read
                  </Text>
                  <MarketRead tiles={readTiles} />
                </Stack>
              </Center>

              <Stack gap={6}>
                <Text size="xs" c="gray.5" tt="uppercase" fw={600} style={{ letterSpacing: "0.1em" }}>
                  Today&apos;s buy call · {fmtDate(today.date)}
                </Text>
                <Text size={isMobile ? "26px" : "34px"} fw={900} c={`${postColor}.4`} lh={1.05}>
                  {postureHeadline(todayThrottle.mode)}
                </Text>
                <Text size="sm" c="gray.3">
                  {postureReason(todayThrottle.mode)}
                </Text>
                <Group gap="lg" mt={4}>
                  <Text size="xs" c="gray.4">
                    Position: <b>Hold all TQQQ</b> — never sold; this governs new buys only
                  </Text>
                  {lastPostureChange && (
                    <Text size="xs" c="gray.4">
                      Since: <b>{postureHeadline(lastPostureChange.mode).split(" — ")[0]}</b> ·{" "}
                      {fmtDate(lastPostureChange.date)}
                    </Text>
                  )}
                </Group>
                <Text size="xs" c="gray.6" mt={2}>
                  composite {latest.composite!.toFixed(1)} · fragility {latest.fragility?.toFixed(1)} · euphoria{" "}
                  {latest.euphoria?.toFixed(1)}
                  {bottomZone ? " · capitulation buy zone" : ""}
                </Text>
              </Stack>
            </SimpleGrid>
          </Paper>

          {/* ---- TQQQ ladder + graded buy throttle (backtest evidence) ---- */}
          {ladder && ladderView && (
            <Paper p="md" radius={CARD_RADIUS} withBorder>
              <Text size="sm" fw={600} mb={2}>
                Your TQQQ ladder + graded buy throttle
              </Text>
              <Text size="xs" c="dimmed" mb="sm">
                Evidence behind today&apos;s call: the ladder buys dips / sells rips, and the throttle (which drives the
                slow/pause signal above) scales new buys down as fragility builds — half size, then paused — so it keeps
                dry powder instead of deploying into a falling knife, then redeploys fully once a capitulation bottom is
                confirmed. It never sells your existing TQQQ. Start {fmtUsd(ladderParams.startingCash)}.
              </Text>
              <Box h={isMobile ? 200 : 260}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={ladderView.equity}
                    margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                    onMouseDown={onZoomDown}
                    onMouseMove={onZoomMove}
                    onMouseUp={onZoomUp}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--mantine-color-dark-4)" />
                    <XAxis dataKey="date" tickFormatter={tickFormatter} minTickGap={40} fontSize={11} />
                    <YAxis domain={ladderView.domain} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} fontSize={11} width={48} />
                    <Tooltip
                      labelFormatter={(l) => fmtDate(String(l))}
                      formatter={(v, name) => [`$${Math.round(Number(v)).toLocaleString()}`, name]}
                      contentStyle={{ background: "var(--mantine-color-dark-7)", border: "none", borderRadius: 8 }}
                    />
                    {ladder.spansHalf.filter((s) => inZoom(s.x1) || inZoom(s.x2)).map((s, i) => (
                      <ReferenceArea key={`h${i}`} x1={s.x1} x2={s.x2} fill="var(--mantine-color-yellow-6)" fillOpacity={0.15} />
                    ))}
                    {ladder.spansPause.filter((s) => inZoom(s.x1) || inZoom(s.x2)).map((s, i) => (
                      <ReferenceArea key={`p${i}`} x1={s.x1} x2={s.x2} fill="var(--mantine-color-red-6)" fillOpacity={0.18} />
                    ))}
                    <Line type="monotone" dataKey="base" name="Ladder only" stroke="var(--mantine-color-gray-5)" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                    <Line type="monotone" dataKey="thr" name="Ladder + throttle" stroke="var(--mantine-color-teal-4)" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                    {selL && selR && <ReferenceArea x1={selL} x2={selR} fill="var(--mantine-color-gray-3)" fillOpacity={0.18} />}
                  </ComposedChart>
                </ResponsiveContainer>
              </Box>
              <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs" mt="sm">
                <SummaryStat label="Final (ladder)" follow={ladder.base.finalValue} hold={ladder.base.finalValue} dollars />
                <SummaryStat label="Final (+throttle)" follow={ladder.thr.finalValue} hold={ladder.base.finalValue} dollars />
                <SummaryStat label="Max DD (ladder)" follow={ladder.base.maxDrawdown} hold={ladder.thr.maxDrawdown} pct higherBetter />
                <SummaryStat label="Max DD (+throttle)" follow={ladder.thr.maxDrawdown} hold={ladder.base.maxDrawdown} pct higherBetter />
              </SimpleGrid>
              <Text size="xs" c="dimmed" mt="sm">
                Amber shading = half-size buys (fragility ≥ 1.5); red shading = buys paused (fragility ≥ 2.5). Both lift
                to full deployment once a capitulation bottom is confirmed (deep composite + price turning up), so the
                preserved cash redeploys into the rebound. In a V-shaped dip like March 2026 the throttle gives back a
                little vs. buying all the way down; its payoff is the no-bounce crash where it keeps powder. Ladder: 88
                levels, {ladderParams.sellPct}% sell, reduction {ladderParams.reductionFactor}
                {activeAccount?.settings?.sellPercentage ? " (from your account settings)" : ""}. Fills use each
                day&apos;s intraday high/low — calibrated against hourly TQQQ to within ~16% of true intraday harvest.
                Ignores fees/taxes.
              </Text>
            </Paper>
          )}

          {/* ---- Details ---- */}
          <Accordion variant="separated" radius={CARD_RADIUS} multiple defaultValue={["oscillator"]}>
            <Accordion.Item value="oscillator">
              <Accordion.Control>
                <Text size="sm" fw={600}>
                  S&amp;P 500 vs composite oscillator
                </Text>
              </Accordion.Control>
              <Accordion.Panel>
                <Text size="xs" c="dimmed" mb={4}>
                  S&amp;P 500 (blue) with its 200-day average (amber — dip context: below it = you&apos;re in a drawdown)
                  — same time axis as the oscillator below, so you can see how fragility/buy-zone extremes line up with
                  price. Drag across either chart to zoom into a section.
                </Text>
                <Box h={isMobile ? 150 : 190}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={priceDataV}
                      margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                      syncId="anomaly"
                      onMouseDown={onZoomDown}
                      onMouseMove={onZoomMove}
                      onMouseUp={onZoomUp}
                    >
                      <defs>
                        <linearGradient id="spxGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--mantine-color-blue-4)" stopOpacity={0.5} />
                          <stop offset="100%" stopColor="var(--mantine-color-blue-4)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--mantine-color-dark-4)" />
                      <XAxis dataKey="date" tickFormatter={tickFormatter} minTickGap={40} fontSize={11} />
                      <YAxis domain={spxDomainV} tickFormatter={(v) => Math.round(v).toLocaleString()} fontSize={11} width={48} />
                      <Tooltip
                        labelFormatter={(l) => fmtDate(String(l))}
                        formatter={(v, name) => [Math.round(Number(v)).toLocaleString(), name]}
                        contentStyle={{ background: "var(--mantine-color-dark-7)", border: "none", borderRadius: 8 }}
                      />
                      <Area type="monotone" dataKey="spx" name="S&P 500" stroke="var(--mantine-color-blue-4)" strokeWidth={1.5} fill="url(#spxGrad)" isAnimationActive={false} />
                      <Line type="monotone" dataKey="ma" name="200-day avg" stroke="var(--mantine-color-yellow-5)" dot={false} strokeWidth={1.25} connectNulls isAnimationActive={false} />
                      {selL && selR && <ReferenceArea x1={selL} x2={selR} fill="var(--mantine-color-gray-3)" fillOpacity={0.18} />}
                    </ComposedChart>
                  </ResponsiveContainer>
                </Box>
                <Box h={isMobile ? 220 : 280}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={pointsV}
                      margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                      syncId="anomaly"
                      onMouseDown={onZoomDown}
                      onMouseMove={onZoomMove}
                      onMouseUp={onZoomUp}
                    >
                      <defs>
                        <linearGradient id="compGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--mantine-color-teal-5)" stopOpacity={0.6} />
                          <stop offset="50%" stopColor="var(--mantine-color-teal-5)" stopOpacity={0.05} />
                          <stop offset="100%" stopColor="var(--mantine-color-red-5)" stopOpacity={0.6} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--mantine-color-dark-4)" />
                      <XAxis dataKey="date" tickFormatter={tickFormatter} minTickGap={40} fontSize={11} />
                      <YAxis domain={[-6, 4]} fontSize={11} width={48} />
                      <Tooltip
                        labelFormatter={(l) => fmtDate(String(l))}
                        formatter={(v, name) => [Number(v).toFixed(2), name]}
                        contentStyle={{ background: "var(--mantine-color-dark-7)", border: "none", borderRadius: 8 }}
                      />
                      <ReferenceLine y={0} stroke="var(--mantine-color-gray-6)" />
                      <ReferenceLine y={BOOM_EUPHORIA_ENTER} stroke="var(--mantine-color-teal-5)" strokeDasharray="4 4" label={{ value: "boom", fontSize: 10, fill: "var(--mantine-color-teal-4)", position: "insideTopRight" }} />
                      <ReferenceLine y={-CRASH_ENTER} stroke="var(--mantine-color-red-5)" strokeDasharray="4 4" label={{ value: "crash", fontSize: 10, fill: "var(--mantine-color-red-4)", position: "insideBottomRight" }} />
                      <ReferenceLine y={DEEP_BUY_Z} stroke="var(--mantine-color-teal-4)" strokeDasharray="4 4" label={{ value: "buy zone", fontSize: 10, fill: "var(--mantine-color-teal-4)", position: "insideBottomRight" }} />
                      <Area type="monotone" dataKey="composite" name="Composite" stroke="var(--mantine-color-gray-3)" strokeWidth={1.5} fill="url(#compGrad)" isAnimationActive={false} />
                      <Line type="monotone" dataKey="fragility" name="Fragility" stroke="var(--mantine-color-red-5)" dot={false} strokeWidth={1} isAnimationActive={false} />
                      <Line type="monotone" dataKey="euphoria" name="Euphoria" stroke="var(--mantine-color-teal-5)" dot={false} strokeWidth={1} isAnimationActive={false} />
                      {selL && selR && <ReferenceArea x1={selL} x2={selR} fill="var(--mantine-color-gray-3)" fillOpacity={0.18} />}
                    </ComposedChart>
                  </ResponsiveContainer>
                </Box>
                <Text size="xs" c="dimmed" mt={4}>
                  Fragility (red) is the crash-risk gauge that drives the throttle: ≥ 1.5 → half-size buys, ≥ 2.5 →
                  pause. When the composite reaches the buy zone (≤ {DEEP_BUY_Z}) it&apos;s deep capitulation — the
                  throttle lifts to full and you redeploy into TQQQ. Crash arms at fragility ≥ {CRASH_ENTER} (stands
                  down below {CRASH_EXIT}); boom (euphoria ≥ {BOOM_EUPHORIA_ENTER}) rarely leads a top, so it is not
                  used to sell.
                </Text>
              </Accordion.Panel>
            </Accordion.Item>

            <Accordion.Item value="method">
              <Accordion.Control>
                <Text size="sm" fw={600}>
                  How it works &amp; data sources
                </Text>
              </Accordion.Control>
              <Accordion.Panel>
                <Stack gap="sm">
                  <Text size="sm" c="dimmed">
                    Systemic Fragility &amp; Euphoria Composite (SFEC): a causal, multi-factor z-score blend. The market
                    read up top distills it into trend, pullback, crash-risk and buy-zone. It is a contrarian /
                    mean-reversion tool — fragility peaks AT the crash/bottom, so it is not a leading crash predictor.
                  </Text>
                  <Text size="sm" fw={600}>
                    The four buy postures — you always keep your TQQQ
                  </Text>
                  <List size="sm" spacing={4}>
                    <List.Item>
                      <b>Buy normally</b> — calm: run the full ladder, buying every dip level.
                    </List.Item>
                    <List.Item>
                      <b>Slow (half)</b> — fragility ≥ 1.5: buy half-size lots to start saving dry powder.
                    </List.Item>
                    <List.Item>
                      <b>Pause</b> — fragility ≥ 2.5: stop new buys so you don&apos;t spend powder into a falling knife.
                    </List.Item>
                    <List.Item>
                      <b>Resume / buy the bottom</b> — a capitulation low is confirmed (composite ≤ {DEEP_BUY_Z} then
                      price turns up): redeploy the saved powder to catch the bounce.
                    </List.Item>
                  </List>
                  <Text size="sm" fw={600} c="red.4">
                    Fragility (fear) factors
                  </Text>
                  <List size="sm" spacing={4}>
                    <List.Item>VIX term structure — ^VIX / ^VIX3M</List.Item>
                    <List.Item>Credit stress — HYG / LQD momentum</List.Item>
                    <List.Item>Equity realized volatility — 20-day ^GSPC</List.Item>
                    <List.Item>Drawdown from the trailing 1-year high</List.Item>
                  </List>
                  <Text size="sm" fw={600} c="teal.4">
                    Euphoria (greed) factors
                  </Text>
                  <List size="sm" spacing={4}>
                    <List.Item>Extension above the 200-day moving average</List.Item>
                    <List.Item>Trend quality — 60-day return ÷ volatility</List.Item>
                    <List.Item>Stocks-vs-bonds momentum (^GSPC / TLT)</List.Item>
                    <List.Item>RSI(14) distance from neutral</List.Item>
                  </List>
                  <Text size="sm" c="dimmed">
                    Each factor → trailing {DEFAULT_PARAMS.zWindow}-day z-score (no look-ahead), IC-weighted into the two
                    sub-indices. All data is free (Yahoo Finance + FRED). Ignores fees and taxes.
                  </Text>
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </>
      ) : (
        <Center h={300}>
          <Text c="dimmed">No data.</Text>
        </Center>
      )}
    </Stack>
  );
}

/** Compact follow-vs-hold stat for the backtest summary grid. */
function SummaryStat({
  label,
  follow,
  hold,
  pct,
  dollars,
  higherBetter = true,
}: {
  label: string;
  follow: number;
  hold: number;
  pct?: boolean;
  dollars?: boolean;
  higherBetter?: boolean;
}) {
  const fmt = (x: number) =>
    dollars ? fmtUsd(x) : pct ? `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%` : x.toFixed(2);
  const same = follow === hold;
  const win = higherBetter ? follow > hold : follow < hold;
  return (
    <Stack gap={0}>
      <Text size="10px" c="dimmed" tt="uppercase" style={{ letterSpacing: "0.08em" }}>
        {label}
      </Text>
      <Text size="lg" fw={700} c={!same && win ? "teal.4" : undefined}>
        {fmt(follow)}
      </Text>
      {!same && (
        <Text size="10px" c="dimmed">
          {dollars ? "vs" : "hold"} {fmt(hold)}
        </Text>
      )}
    </Stack>
  );
}
