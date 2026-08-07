"use client";

import { useState, useEffect, useMemo } from "react";
import { useMediaQuery } from "@mantine/hooks";
import {
  Paper,
  Stack,
  Text,
  Group,
  Box,
  SimpleGrid,
  Badge,
  Alert,
  Center,
  Loader,
  Slider,
  SegmentedControl,
  Table,
  Divider,
  ThemeIcon,
  Accordion,
  Checkbox,
  Progress,
  Skeleton,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconShoppingCart,
  IconTrash,
  IconCheck,
  IconLock,
  IconCoins,
  IconRefresh,
  IconSettings,
  IconCircleCheckFilled,
  IconCircleDotFilled,
  IconAlertTriangleFilled,
} from "@tabler/icons-react";
import {
  ResponsiveContainer,
  ComposedChart,
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ChartTooltip,
  ReferenceLine,
} from "recharts";
import { Outfit } from "next/font/google";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { useApp } from "@/lib/context/AppContext";
import { useBalances } from "@/lib/hooks/useBalances";
import { useAccountColor } from "@/lib/hooks/useAccountColor";
import { useCardBg } from "@/lib/hooks/useCardBg";
import { useChartCandles } from "@/lib/hooks/useChartCandles";
import { CARD_RADIUS, CARD_LABEL_STYLE } from "@/lib/cardStyles";
import { createMask, fmt } from "@/lib/format";
import {
  planProgram,
  scenarioTable,
  hedgeLots,
  hedgeSpend,
  qqqPutsInTqqqTerms,
  openContractsBySleeve,
  MIN_HEDGE_DTE,
  budgetStatus,
  tqqqIvFromVxn,
  type RebalanceAction,
} from "@/lib/putProgram";
import {
  hedgeTodos,
  putBuyClimate,
  vixBuyClimate,
  HARVEST_DELTA,
  HARVEST_GAIN_PCT,
  ROLL_DTE,
  type HedgeTodoKind,
  type HedgeLayer,
  type BuyClimate,
  type ClimateVerdict,
} from "@/lib/hedgeReview";
import { planVixLayer, vixPayoff, EPISODES } from "@/lib/vixLayer";
import { mergeHedgeSettings, type HedgeSettings } from "@/lib/hedgeSettings";

const outfit = Outfit({ subsets: ["latin"] });

const DTE_CHOICES = ["30", "45", "60", "90"];

/**
 * The two sleeves read as one colour each, everywhere on the page: blue is the
 * put layer, violet the VIX layer. The pair separates by ΔE 21 under
 * red/green colour blindness and sits clear of the status colours already in
 * use here — teal for profit, orange for sell, yellow for gated, red for loss —
 * so layer identity and state never compete for the same hue. Colour is always
 * the second signal: every element it marks also carries a word or a glyph.
 */
const PUT_COLOR = "blue";
const VIX_COLOR = "violet";
/** The validated marks, for anything that needs a literal (charts, dots). */
const PUT_MARK = "var(--mantine-color-blue-3)";
const VIX_MARK = "var(--mantine-color-violet-5)";

const layerColor = (layer: HedgeLayer) => (layer === "vix" ? VIX_COLOR : PUT_COLOR);
const layerMark = (layer: HedgeLayer) => (layer === "vix" ? VIX_MARK : PUT_MARK);
/** Ink Mantine guarantees against a tint of the same hue. */
const layerInk = (layer: HedgeLayer) => `var(--mantine-color-${layerColor(layer)}-light-color)`;

/**
 * How much of a sleeve's hue reaches its card wash. Twice the neutral card's
 * 15%, so these surfaces read as filled rather than merely tinted, while
 * keeping the same gloss and gradient as every other card on the page.
 */
const LAYER_MIX = 32;

/**
 * Quarter boundaries as a fraction of the annual budget. The budget is spent
 * evenly across the calendar, so 25% of it is what should be gone by Apr 1 —
 * which makes these lines a pace scale, not just decoration.
 */
const QUARTER_MARKS = [
  { pct: 25, label: "Apr 1" },
  { pct: 50, label: "Jul 1" },
  { pct: 75, label: "Oct 1" },
];

/**
 * The verdict is carried by an icon, not by coloured words: status hues, not
 * layer hues — the card already carries identity — and leaving the sentence in
 * plain ink keeps it readable at any severity. The glyph differs as well as the
 * colour, so the signal survives without it.
 */
const CLIMATE_ICON: Record<BuyClimate, { Icon: typeof IconCheck; color: string }> = {
  good: { Icon: IconCircleCheckFilled, color: "var(--mantine-color-teal-4)" },
  poor: { Icon: IconAlertTriangleFilled, color: "var(--mantine-color-orange-4)" },
  neutral: { Icon: IconCircleDotFilled, color: "var(--mantine-color-dimmed)" },
};

const TODO_ICON: Record<HedgeTodoKind, typeof IconCheck> = {
  harvest: IconCoins,
  roll: IconRefresh,
  open: IconShoppingCart,
  trim: IconTrash,
  hold: IconCheck,
};

/**
 * Mantine positions slider mark labels absolutely, so they reserve no layout
 * height and would sit on top of the caption below.
 */
const SLIDER_MB = 26;

/** Hue is spent on layer identity, so the action shows up as a glyph and a verb. */
const ACTION_STYLE: Record<RebalanceAction, { label: string; Icon: typeof IconCheck }> = {
  buy: { label: "Buy", Icon: IconShoppingCart },
  sell: { label: "Sell", Icon: IconTrash },
  hold: { label: "Hold", Icon: IconCheck },
};

/** A layer's identity dot, for labels that need to say which sleeve they mean. */
function LayerDot({ layer }: { layer: HedgeLayer }) {
  return (
    <Box
      component="span"
      mr={6}
      style={{
        display: "inline-block",
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: layerMark(layer),
        verticalAlign: "middle",
      }}
    />
  );
}

/**
 * The dashboard's hero-number treatment, reused for the sizing row: Outfit,
 * digit reels that roll on change, one card per figure. These four are the
 * page's headline answers — how much of each sleeve to hold — so they get the
 * weight rather than the paragraph-sized type the supporting tiles use.
 */
function HeroStat({
  label,
  value,
  sub,
  color,
  layer,
  cardBg,
}: {
  label: string;
  value: string;
  sub?: string;
  /** Mantine palette key, for a value that is warning about something. */
  color?: string;
  layer?: HedgeLayer;
  cardBg: string;
}) {
  return (
    <Paper p="md" radius={CARD_RADIUS} style={{ background: cardBg }}>
      <Stack gap={6} align="center" justify="center" h="100%">
        <Text c="dimmed" tt="uppercase" fw={600} ta="center" style={CARD_LABEL_STYLE}>
          {layer && <LayerDot layer={layer} />}
          {label}
        </Text>
        <AnimatedNumber
          value={value}
          className={outfit.className}
          style={{
            fontSize: "clamp(1.6rem, 5vw, 2.5rem)",
            fontWeight: 700,
            lineHeight: 1,
            color: color ? `var(--mantine-color-${color}-4)` : "white",
          }}
        />
        {sub && (
          <Text size="xs" c="dimmed" ta="center">
            {sub}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

function StatTile({
  label,
  value,
  sub,
  color,
  layer,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  /** Marks the tile as belonging to a sleeve, with a dot beside its label. */
  layer?: HedgeLayer;
}) {
  return (
    <Box>
      <Text c="dimmed" tt="uppercase" style={CARD_LABEL_STYLE}>
        {layer && <LayerDot layer={layer} />}
        {label}
      </Text>
      <Text size="lg" fw={700} c={color} style={{ lineHeight: 1.2 }}>
        {value}
      </Text>
      {sub && (
        <Text size="xs" c="dimmed">
          {sub}
        </Text>
      )}
    </Box>
  );
}

/**
 * A week of the sleeve's underlying, as a sparkline.
 *
 * Context for the instruction above it: the ring says how covered you are, this
 * says what the thing you're hedging has been doing. No axes — the shape and
 * the labelled change carry it, and a baseline at the window's open makes the
 * direction readable without one.
 */
function Sparkline({
  layer,
  label,
  candles,
  loading,
  decimals,
  verdict,
}: {
  layer: HedgeLayer;
  label: string;
  candles: { time: number; close: number }[];
  loading: boolean;
  decimals: number;
  /** Whether today is a cheap day to add — computed per sleeve by the caller. */
  verdict: ClimateVerdict;
}) {
  const mark = layerMark(layer);
  const frame = (children: React.ReactNode) => (
    <Box
      p="sm"
      style={{
        border: "1px solid var(--mantine-color-dark-4)",
        borderRadius: 12,
      }}
    >
      {children}
    </Box>
  );
  if (loading) return frame(<Skeleton height={78} radius="md" />);
  if (candles.length < 2) {
    return frame(
      <Text size="xs" c="dimmed" ta="center">
        No {label} history
      </Text>,
    );
  }
  const open = candles[0].close;
  const last = candles[candles.length - 1].close;
  const changePct = ((last - open) / open) * 100;
  return frame(
    <>
      <Group justify="space-between" mb={2} wrap="nowrap">
        <Text size="10px" c="dimmed" tt="uppercase" style={CARD_LABEL_STYLE}>
          {label} · 7 days
        </Text>
        <Text size="xs" fw={600} c={changePct >= 0 ? "teal" : "red"}>
          {fmt(last, decimals)} ({changePct >= 0 ? "+" : "−"}
          {fmt(Math.abs(changePct), 1)}%)
        </Text>
      </Group>
      <Box h={56}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={candles} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`spark-${layer}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={mark} stopOpacity={0.35} />
                <stop offset="100%" stopColor={mark} stopOpacity={0} />
              </linearGradient>
            </defs>
            <YAxis hide domain={["dataMin", "dataMax"]} />
            <ReferenceLine
              y={open}
              stroke="var(--mantine-color-dark-3)"
              strokeDasharray="3 3"
            />
            <ChartTooltip
              contentStyle={{
                background: "var(--mantine-color-dark-7)",
                border: "1px solid var(--mantine-color-dark-4)",
                borderRadius: 8,
                fontSize: 11,
              }}
              labelFormatter={(_, p) =>
                p?.[0] ? new Date(p[0].payload.time).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                }) : ""
              }
              formatter={(v) => [fmt(Number(v), decimals), label]}
            />
            <Area
              type="monotone"
              dataKey="close"
              stroke={mark}
              strokeWidth={2}
              fill={`url(#spark-${layer})`}
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </Box>
      <Group gap={8} wrap="nowrap" align="flex-start" mt={8}>
        <Box style={{ color: CLIMATE_ICON[verdict.climate].color, lineHeight: 0, paddingTop: 1 }}>
          {(() => {
            const { Icon: ClimateIcon } = CLIMATE_ICON[verdict.climate];
            return <ClimateIcon size={15} />;
          })()}
        </Box>
        <Text size="xs" c="dimmed" style={{ lineHeight: 1.35 }}>
          {verdict.message}
        </Text>
      </Group>
    </>,
  );
}

/**
 * A sleeve's coverage: the ring is target, the arc is what's held.
 *
 * A ring whose circumference *is* the target keeps the "how full am I" glance a
 * pie gives, and unlike a pie it has an honest place for overshoot — a second
 * lap drawn inside the ring. A full ring means exactly on target.
 */
function CoverageDonut({
  layer,
  held,
  target,
  size = 176,
}: {
  layer: HedgeLayer;
  held: number;
  target: number;
  size?: number;
}) {
  const R = size / 2 - 12;
  const frac = target > 0 ? held / target : held > 0 ? 1 : 0;
  const mark = layerMark(layer);
  const arc = (radius: number, portion: number, opacity: number, width: number) => (
    <circle
      cx={size / 2}
      cy={size / 2}
      r={radius}
      fill="none"
      stroke={mark}
      strokeOpacity={opacity}
      strokeWidth={width}
      strokeLinecap="round"
      strokeDasharray={`${2 * Math.PI * radius * Math.min(portion, 1)} ${2 * Math.PI * radius}`}
      transform={`rotate(-90 ${size / 2} ${size / 2})`}
    />
  );
  // A fractional count is a QQQ conversion; whole numbers stay whole.
  const shown = Number.isInteger(held) ? String(held) : fmt(held, 1);
  return (
    <Box style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg
        width={size}
        height={size}
        role="img"
        aria-label={`${shown} of ${target} contracts held`}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={R}
          fill="none"
          stroke="var(--mantine-color-dark-5)"
          strokeWidth={16}
        />
        {arc(R, frac, 1, 16)}
        {frac > 1 && arc(R - 15, frac - 1, 0.55, 9)}
      </svg>
      <Stack gap={0} align="center" justify="center" style={{ position: "absolute", inset: 0 }}>
        <Text
          className={outfit.className}
          style={{ fontSize: "1.75rem", fontWeight: 700, lineHeight: 1, color: "white" }}
        >
          {shown}/{target}
        </Text>
        <Text size="xs" c="dimmed" mt={4}>
          {fmt(frac * 100, 0)}% of target
        </Text>
      </Stack>
    </Box>
  );
}

/**
 * Spend against a budget for one window — bar clamped, caption exact.
 *
 * `marks` cut the bar at fixed percentages. On the yearly bar those are the
 * quarter boundaries, which turns the bar into a pace reading: the budget is
 * spent evenly by the calendar, so a fill past the Apr 1 line before April is
 * spending ahead of the year.
 */
function SpendBar({
  label,
  spent,
  budget,
  color,
  mask,
  marks = [],
}: {
  label: string;
  spent: number;
  budget: number;
  color: string;
  mask: (s: string) => string;
  marks?: { pct: number; label: string }[];
}) {
  const pct = budget > 0 ? (spent / budget) * 100 : 0;
  const over = pct > 100;
  return (
    <Box>
      <Group justify="space-between" mb={4}>
        <Text size="xs" fw={600}>
          {label}
        </Text>
        <Text size="xs" c={over ? "orange" : "dimmed"}>
          {mask(`$${fmt(spent, 0)}`)} of {mask(`$${fmt(budget, 0)}`)} · {fmt(pct, 0)}%
          {over ? " — over" : ""}
        </Text>
      </Group>
      <Box style={{ position: "relative" }}>
        <Progress.Root size="lg" radius="xl">
          <Progress.Section
            value={Math.min(100, Math.max(pct, 0))}
            color={over ? "orange" : color}
          />
        </Progress.Root>
        {marks.map((m) => (
          <Box
            key={m.label}
            style={{
              position: "absolute",
              left: `${m.pct}%`,
              top: 0,
              bottom: 0,
              width: 2,
              background: "var(--mantine-color-body)",
              opacity: 0.85,
            }}
          />
        ))}
      </Box>
      {marks.length > 0 && (
        <Box style={{ position: "relative", height: 14, marginTop: 2 }}>
          {marks.map((m) => (
            <Text
              key={m.label}
              size="10px"
              c="dimmed"
              style={{
                position: "absolute",
                left: `${m.pct}%`,
                transform: "translateX(-50%)",
                whiteSpace: "nowrap",
              }}
            >
              {m.label}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

function ActionCard({
  title,
  layer,
  action,
  headline,
  detail,
  note,
  cost,
  costLabel,
  gated,
  cardBg,
  coverage,
  chart,
  mask,
}: {
  title: string;
  layer: HedgeLayer;
  action: RebalanceAction;
  headline: string;
  detail: string;
  note?: string;
  cost: number;
  costLabel: string;
  gated?: boolean;
  /** The sleeve's own glossy surface, from useCardBg at LAYER_MIX. */
  cardBg: string;
  /** Held against target, drawn as a ring beside the instruction. */
  coverage: { held: number; target: number; note: string };
  /** A week of the underlying, under the instruction. */
  chart: React.ReactNode;
  mask: (s: string) => string;
}) {
  const act = ACTION_STYLE[action];
  const Icon = gated ? IconLock : act.Icon;
  return (
    // The whole surface carries the sleeve's hue, so these two read as a pair
    // apart from the neutral cards below them.
    <Paper p="lg" radius={CARD_RADIUS} style={{ background: cardBg }}>
      <Group justify="space-between" align="flex-start" wrap="nowrap" mb="xs">
        <Text tt="uppercase" style={{ ...CARD_LABEL_STYLE, color: layerInk(layer) }}>
          {title}
        </Text>
        <Text size="xs" c="dimmed" ta="right" style={{ lineHeight: 1.3 }}>
          {mask(`$${fmt(cost, 0)}`)}
          <br />
          {costLabel}
        </Text>
      </Group>
      <Stack gap="md" align="center">
        <CoverageDonut layer={layer} held={coverage.held} target={coverage.target} />
        <Group gap="md" wrap="nowrap" align="flex-start" style={{ minWidth: 0 }}>
          {/* Hue says which sleeve; the glyph says buy / sell / hold. Gated is
              the one exception — a blocked entry is a state worth shouting.
              Filled, not light, so the icon separates from the tinted surface. */}
          <ThemeIcon
            size={44}
            radius="xl"
            color={gated ? "yellow" : layerColor(layer)}
            variant="filled"
          >
            <Icon size={22} />
          </ThemeIcon>
          <Box style={{ minWidth: 0 }}>
            <Text size="lg" fw={700} style={{ lineHeight: 1.2 }}>
              {headline}
            </Text>
            <Text size="sm" c="dimmed">
              {detail}
            </Text>
            {note && (
              <Text size="xs" c={gated ? "yellow" : "dimmed"} mt={2}>
                {note}
              </Text>
            )}
            <Text size="xs" c="dimmed" mt={4}>
              {coverage.note}
            </Text>
          </Box>
        </Group>
        <Box w="100%">{chart}</Box>
      </Stack>
    </Paper>
  );
}

export default function HedgePage() {
  const {
    activeAccount,
    quote,
    privacyMode,
    optionPositions,
    filledOptionOrders,
    tqqqShares,
    updateAccountSettings,
  } = useApp();
  const { balance } = useBalances();
  const color = useAccountColor();
  const cardBg = useCardBg(color);
  const putBg = useCardBg(PUT_COLOR, LAYER_MIX);
  const vixBg = useCardBg(VIX_COLOR, LAYER_MIX);
  // The hero row sits at the neutral card's strength — four filled cards at the
  // action cards' weight would fight them for the top of the page.
  const putTileBg = useCardBg(PUT_COLOR);
  const tqqqCandles = useChartCandles("1w", "TQQQ");
  const vixCandles = useChartCandles("1w", "^VIX");
  const vixTileBg = useCardBg(VIX_COLOR);
  const isMobile = useMediaQuery("(max-width: 768px)");
  const mask = createMask(privacyMode);

  // ── controls ───────────────────────────────────────────────────────────────
  // Held locally so dragging a slider stays responsive, then committed to the
  // account on release — persisting every intermediate value would hammer
  // Supabase with a write per pixel.
  const saved = useMemo(
    () => mergeHedgeSettings(activeAccount?.settings.hedgeSettings),
    [activeAccount],
  );
  const [draft, setDraft] = useState<HedgeSettings>(saved);

  // Re-sync when the active account changes, adjusted during render per React
  // docs rather than in an effect.
  const [syncKey, setSyncKey] = useState(activeAccount?.accountNumber ?? null);
  if (syncKey !== (activeAccount?.accountNumber ?? null)) {
    setSyncKey(activeAccount?.accountNumber ?? null);
    setDraft(saved);
  }

  const set = <K extends keyof HedgeSettings>(key: K, value: HedgeSettings[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  /** Write the whole blob back to the account. */
  const commit = (next: HedgeSettings) => {
    if (!activeAccount) return;
    updateAccountSettings(activeAccount.accountNumber, { hedgeSettings: next });
  };
  const commitKey = <K extends keyof HedgeSettings>(key: K, value: HedgeSettings[K]) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    commit(next);
  };

  const {
    budgetPct,
    putSharePct: putShare,
    putDelta: targetDelta,
    driftBandPct,
    vixStrikeOffset,
    volOfVol,
    maxEntryVix,
    monetizeVix,
    excludedSymbols,
  } = draft;
  const dte = String(draft.putDte);
  const vixDte = String(draft.vixDte);

  const excluded = useMemo(() => new Set(excludedSymbols), [excludedSymbols]);
  /** Tick or untick one lot, persisting immediately — there is no drag to debounce. */
  const toggleLot = (symbol: string) =>
    commitKey(
      "excludedSymbols",
      excluded.has(symbol)
        ? excludedSymbols.filter((s) => s !== symbol)
        : [...excludedSymbols, symbol],
    );

  // ── live inputs ────────────────────────────────────────────────────────────
  const [vxn, setVxn] = useState<number | null>(null);
  /** ^VXN's percentile within its own year — how dear protection is right now. */
  const [ivRank, setIvRank] = useState<number | null>(null);
  const [vix, setVix] = useState<number | null>(null);
  const [vix3m, setVix3m] = useState<number | null>(null);
  /** QQQ spot, to restate QQQ puts in TQQQ terms. */
  const [qqqSpot, setQqqSpot] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const num = async (url: string, key: string) => {
        try {
          const r = await fetch(url);
          if (!r.ok) return null;
          const j = await r.json();
          return typeof j[key] === "number" ? j[key] : null;
        } catch {
          return null;
        }
      };
      const [iv, rank, v, v3, q] = await Promise.all([
        num("/api/iv-rank", "vxnPct"),
        num("/api/iv-rank", "ivRank"),
        num("/api/quote?symbol=%5EVIX", "price"),
        num("/api/quote?symbol=%5EVIX3M", "price"),
        num("/api/quote?symbol=QQQ", "price"),
      ]);
      if (cancelled) return;
      setVxn(iv);
      setIvRank(rank);
      setVix(v);
      setVix3m(v3);
      setQqqSpot(q);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const tqqqSpot = quote.price;
  const baseIv = vxn != null ? tqqqIvFromVxn(vxn) : null;
  const dteNum = Number(dte);
  const vixDteNum = Number(vixDte);
  const accountValue = balance?.totalValue ?? 0;

  const yearStart = useMemo(() => new Date(new Date().getFullYear(), 0, 1), []);

  const lots = useMemo(() => {
    const marks = new Map<string, number>();
    for (const p of optionPositions) {
      if (p.longQty > 0) marks.set(p.symbol.replace(/\s+/g, ""), p.marketValue / p.longQty);
    }
    const today = new Date().toISOString().slice(0, 10);
    return hedgeLots(filledOptionOrders, yearStart).map((lot) => {
      const perContract = marks.get(lot.symbol.replace(/\s+/g, "")) ?? null;
      const openValue =
        lot.openContracts === 0
          ? 0
          : perContract != null
            ? perContract * lot.openContracts
            : lot.expiry != null && lot.expiry < today
              ? 0
              : null;
      return {
        ...lot,
        openValue,
        net: openValue == null ? null : lot.proceeds + openValue - lot.cost,
      };
    });
  }, [filledOptionOrders, optionPositions, yearStart]);

  /** QQQ puts restated in TQQQ puts, so one ring can hold both. */
  /**
   * Coverage comes from the kept lots, not the position feed, so the rings
   * agree with the budget list: untick a trade and it stops counting here too.
   */
  const heldPuts = useMemo(() => openContractsBySleeve(lots, excluded), [lots, excluded]);
  const putEquivalents = useMemo(
    () => heldPuts.tqqqPuts + qqqPutsInTqqqTerms(heldPuts.qqqPuts, qqqSpot ?? 0, tqqqSpot),
    [heldPuts, qqqSpot, tqqqSpot],
  );

  const putPlan = useMemo(() => {
    if (!tqqqSpot || !baseIv || accountValue <= 0) return null;
    return planProgram({
      accountValue,
      tqqqShares,
      tqqqSpot,
      baseIv,
      dte: dteNum,
      budgetPctPerYear: budgetPct,
      budgetShare: putShare / 100,
      targetDelta: targetDelta / 100,
      driftBandPct,
      currentContracts: Math.round(putEquivalents),
    });
  }, [
    accountValue,
    tqqqShares,
    tqqqSpot,
    baseIv,
    dteNum,
    budgetPct,
    putShare,
    targetDelta,
    driftBandPct,
    putEquivalents,
  ]);

  const vixPlan = useMemo(() => {
    if (vix == null || accountValue <= 0 || putShare >= 100) return null;
    return planVixLayer({
      accountValue,
      budgetPctPerYear: budgetPct,
      budgetShare: 1 - putShare / 100,
      dte: vixDteNum,
      vix,
      vix3m,
      strikeOffset: vixStrikeOffset,
      volOfVol: volOfVol / 100,
      maxEntryVix,
      monetizeVix,
      currentContracts: heldPuts.vix,
    });
  }, [
    accountValue,
    budgetPct,
    putShare,
    vixDteNum,
    vix,
    vix3m,
    vixStrikeOffset,
    volOfVol,
    maxEntryVix,
    monetizeVix,
    heldPuts.vix,
  ]);

  /** What to do with what's already open, and what the plans still want opened. */
  const todos = useMemo(
    () =>
      hedgeTodos({
        positions: optionPositions,
        putPlan,
        vixPlan,
        tqqqSpot,
        baseIv: baseIv ?? 0,
        putDte: dteNum,
        vixDte: vixDteNum,
        vix,
        monetizeVix,
      }),
    [optionPositions, putPlan, vixPlan, tqqqSpot, baseIv, dteNum, vixDteNum, vix, monetizeVix],
  );

  /**
   * Every fill that *could* be hedge spend, itemised per contract and marked
   * against the live position where one is still open. A lot that is neither
   * held nor closed expired worthless, so its remaining value is zero rather
   * than unknown. Which of these actually count is the user's call — see
   * `excluded`.
   */
  const budget = useMemo(
    () => budgetStatus(accountValue * (budgetPct / 100), hedgeSpend(lots, excluded)),
    [accountValue, budgetPct, lots, excluded],
  );

  /**
   * The quarter is its own window rather than a slice of the year's lots: a
   * position opened in March and closed in April belongs to both, and only a
   * fresh pass gets each side's cost and credit into the right bucket.
   */
  const quarterStart = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  }, []);
  const quarterSpent = useMemo(
    () => hedgeSpend(hedgeLots(filledOptionOrders, quarterStart), excluded),
    [filledOptionOrders, quarterStart, excluded],
  );

  /** Each episode as it actually happened: real drawdown, real peak VIX. */
  const episodes = useMemo(() => {
    if (!putPlan || !baseIv || !tqqqSpot) return [];
    return EPISODES.map((e) => {
      // Mark the puts with the episode's vol and whatever time was left.
      const daysLeft = Math.max(dteNum - e.days, 0);
      const row = scenarioTable(putPlan, tqqqShares, tqqqSpot, [e.tqqqMove], {
        iv: tqqqIvFromVxn(e.vixPeak),
        daysLeft,
      })[0];
      const vixPl =
        vixPlan && vixPlan.targetContracts > 0
          ? vixPayoff(vixPlan, vixPlan.targetContracts, e.vixPeak)
          : 0;
      const total = row.putPl + vixPl;
      return {
        label: e.label,
        tqqqMove: e.tqqqMove,
        vixPeak: e.vixPeak,
        sharesPl: row.sharesPl,
        putPl: row.putPl,
        vixPl,
        total,
        offsetPct: row.sharesPl < 0 ? (Math.min(total, -row.sharesPl) / -row.sharesPl) * 100 : 0,
      };
    });
  }, [putPlan, vixPlan, baseIv, tqqqSpot, tqqqShares, dteNum]);

  const curve = useMemo(() => {
    if (!putPlan || !tqqqSpot) return [];
    const moves: number[] = [];
    for (let m = -0.8; m <= 0.2001; m += 0.01) moves.push(m);
    return scenarioTable(putPlan, tqqqShares, tqqqSpot, moves).map((r) => ({
      tqqqPct: r.tqqqMove * 100,
      sharesPl: r.sharesPl,
      net: r.net,
    }));
  }, [putPlan, tqqqShares, tqqqSpot]);

  if (!activeAccount) {
    return (
      <Center h={300}>
        <Text c="dimmed">Select an account to plan a hedge.</Text>
      </Center>
    );
  }

  if (quote.loading || loading) {
    return (
      <Center h={300}>
        <Loader color={color} />
      </Center>
    );
  }

  if (!putPlan) {
    return (
      <Alert icon={<IconAlertTriangle size={18} />} color="yellow" radius={CARD_RADIUS}>
        {accountValue <= 0
          ? "Waiting on account balances — the budget is a percent of account value."
          : "Waiting on ^VXN — premiums can't be modeled without an implied-vol input."}
      </Alert>
    );
  }

  const totalCycleCost = putPlan.cycleCost + (vixPlan?.cycleCost ?? 0);
  // Exclusions can outlive the window they were made in, so count only the ones
  // that apply to what's on screen.
  const excludedHere = lots.filter((l) => excluded.has(l.symbol)).length;

  /**
   * Puts are judged on implied vol, VIX calls on their own price: for that
   * sleeve the underlying *is* volatility, so the tape is the vol signal.
   */
  const putClimate = putBuyClimate(ivRank);
  const vixWeekPct =
    vixCandles.candles.length > 1
      ? ((vixCandles.candles[vixCandles.candles.length - 1].close - vixCandles.candles[0].close) /
          vixCandles.candles[0].close) *
        100
      : 0;
  const vixClimate = vixBuyClimate(
    vixWeekPct,
    vix != null ? { vix, maxEntryVix } : undefined,
  );
  const heldPutCoveragePct =
    tqqqShares > 0 ? ((putEquivalents * 100) / tqqqShares) * 100 : 0;

  return (
    <Stack gap="md">
      <Text fw={700} size="xl">
        Hedge
      </Text>

      {/* ── this week's actions ──────────────────────────────────────────── */}
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <ActionCard
          title="Put layer"
          layer="put"
          action={putPlan.action}
          headline={
            putPlan.action === "hold"
              ? "Hold — inside the band"
              : `${ACTION_STYLE[putPlan.action].label} ${putPlan.actionContracts} TQQQ put${putPlan.actionContracts === 1 ? "" : "s"}`
          }
          detail={`$${fmt(putPlan.strike, 0)} strike · ${dteNum}d · Δ${fmt(Math.abs(putPlan.delta), 2)} · ${fmt(putPlan.otmPct, 1)}% OTM`}
          note={`Drift ${fmt(putPlan.driftPct, 0)}% vs the ${driftBandPct}% band`}
          cost={putPlan.cycleCost}
          costLabel={`per ${dteNum}d roll`}
          cardBg={putBg}
          chart={
            <Sparkline
              layer="put"
              label="TQQQ"
              candles={tqqqCandles.candles}
              loading={tqqqCandles.loading}
              decimals={2}
              verdict={putClimate}
            />
          }
          coverage={{
            held: putEquivalents,
            target: putPlan.targetContracts,
            note: heldPuts.qqqPuts
              ? `${heldPuts.tqqqPuts} TQQQ + ${heldPuts.qqqPuts} QQQ ≈ ${fmt(putEquivalents, 1)} TQQQ-equivalent`
              : `${heldPuts.tqqqPuts} held · ${fmt(heldPutCoveragePct, 0)}% of ${tqqqShares} shares`,
          }}
          mask={mask}
        />
        {vixPlan ? (
          <ActionCard
            title="VIX layer"
            layer="vix"
            action={vixPlan.action}
            headline={
              vixPlan.action === "hold"
                ? vixPlan.gated
                  ? "Gated — vol too high to add"
                  : "Hold"
                : `${ACTION_STYLE[vixPlan.action].label} ${vixPlan.actionContracts} VIX call${vixPlan.actionContracts === 1 ? "" : "s"}`
            }
            detail={`${vixPlan.strike} strike · ${vixDteNum}d · forward ${fmt(vixPlan.forward, 1)} · spot ${fmt(vix ?? 0, 1)}`}
            note={vixPlan.note}
            cost={vixPlan.cycleCost}
            costLabel={`per ${vixDteNum}d roll`}
            gated={vixPlan.gated && !vixPlan.monetize}
            cardBg={vixBg}
            chart={
              <Sparkline
                layer="vix"
                label="VIX"
                candles={vixCandles.candles}
                loading={vixCandles.loading}
                decimals={2}
                verdict={vixClimate}
              />
            }
            coverage={{
              held: heldPuts.vix,
              target: vixPlan.targetContracts,
              note: `${heldPuts.vix} held · convex sleeve`,
            }}
            mask={mask}
          />
        ) : (
          <Paper p="lg" radius={CARD_RADIUS} style={{ background: vixBg }}>
            <Text tt="uppercase" style={{ ...CARD_LABEL_STYLE, color: layerInk("vix") }} mb="xs">
              VIX layer
            </Text>
            <Text size="sm" c="dimmed">
              {putShare >= 100
                ? "Disabled — the whole budget is on the put layer."
                : "Waiting on a ^VIX quote."}
            </Text>
          </Paper>
        )}
      </SimpleGrid>

      {/* ── sizing ───────────────────────────────────────────────────────── */}
      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md">
        <HeroStat
          layer="put"
          label="Put target"
          value={`${putPlan.targetContracts} ct`}
          sub={putPlan.binding === "budget" ? "budget-capped" : "share-count-capped"}
          color={putPlan.binding === "budget" ? "orange" : undefined}
          cardBg={putTileBg}
        />
        <HeroStat
          layer="put"
          label="Coverage"
          value={`${fmt(putPlan.coveragePct, 0)}%`}
          sub={`of ${tqqqShares} shares`}
          cardBg={putTileBg}
        />
        <HeroStat
          layer="vix"
          label="VIX target"
          value={vixPlan ? `${vixPlan.targetContracts} ct` : "—"}
          sub={vixPlan?.gated ? "gated" : "convex sleeve"}
          color={vixPlan?.gated ? "yellow" : undefined}
          cardBg={vixTileBg}
        />
        <HeroStat
          label="Combined carry"
          value={`${fmt(((totalCycleCost * (365 / dteNum)) / accountValue) * 100, 2)}%`}
          sub="of account per year"
          cardBg={cardBg}
        />
      </SimpleGrid>

      {/* ── per-position instructions ────────────────────────────────────── */}
      <Paper p="lg" radius={CARD_RADIUS} style={{ background: cardBg }}>
        <Text fw={600} mb={4}>
          What to do
        </Text>
        <Text size="xs" c="dimmed" mb="md">
          A verdict for every hedge contract open right now, then the orders the plan is still
          missing. Harvest at Δ{HARVEST_DELTA} or +{HARVEST_GAIN_PCT}%, roll inside {ROLL_DTE}d.
        </Text>
        {todos.length === 0 ? (
          <Text size="sm" c="dimmed">
            Nothing to do — no hedge positions open and the plan wants none.
          </Text>
        ) : (
          // A hairline rather than a Divider element: the rule rides on the row
          // itself, so separating the rows costs 8px of padding, not a gap on
          // either side of a component.
          <Stack gap={8}>
            {todos.map((t, i) => {
              const Icon = TODO_ICON[t.kind];
              return (
                <Group
                  key={`${t.kind}-${t.symbol ?? t.label}`}
                  gap="md"
                  wrap="nowrap"
                  align="flex-start"
                  pt={i > 0 ? 8 : 0}
                  style={{
                    borderTop: i > 0 ? "1px solid var(--mantine-color-dark-4)" : undefined,
                  }}
                >
                  <ThemeIcon size={36} radius="xl" color={layerColor(t.layer)} variant="light">
                    <Icon size={18} />
                  </ThemeIcon>
                  <Box style={{ minWidth: 0, flex: 1 }}>
                    <Text size="sm" fw={600} style={{ lineHeight: 1.3 }}>
                      {t.title}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {t.detail}
                    </Text>
                  </Box>
                  {t.value != null && (
                    <Box ta="right" style={{ whiteSpace: "nowrap" }}>
                      <Text size="sm" fw={600}>
                        {mask(`$${fmt(t.value, 0)}`)}
                      </Text>
                      <Text size="xs" c={(t.pl ?? 0) >= 0 ? "teal" : "red"}>
                        {mask(`${(t.pl ?? 0) >= 0 ? "+" : "−"}$${fmt(Math.abs(t.pl ?? 0), 0)}`)}
                        {t.gainPct != null && ` (${fmt(t.gainPct, 0)}%)`}
                      </Text>
                    </Box>
                  )}
                </Group>
              );
            })}
          </Stack>
        )}
      </Paper>

      {/* ── budget pacing ────────────────────────────────────────────────── */}
      <Paper p="lg" radius={CARD_RADIUS} style={{ background: cardBg }}>
        <Group justify="space-between" mb="xs">
          <Text fw={600}>Budget this year</Text>
          <Text size="sm" c={budget.overPace > 0 ? "orange" : "teal"}>
            {budget.overPace > 0 ? "Ahead of pace by " : "Behind pace by "}
            {mask(`$${fmt(Math.abs(budget.overPace), 0)}`)}
          </Text>
        </Group>
        <SimpleGrid cols={{ base: 2, md: 4 }} spacing="lg">
          <StatTile
            label="Spent"
            value={mask(`$${fmt(budget.spent, 0)}`)}
            sub={
              excludedHere > 0
                ? `${lots.length - excludedHere} lots · ${excludedHere} excluded`
                : `${lots.length} lot${lots.length === 1 ? "" : "s"}, bought puts + VIX`
            }
          />
          <StatTile
            label="Left"
            value={mask(`$${fmt(budget.remaining, 0)}`)}
            sub={
              budget.remaining < 0
                ? "over budget"
                : `of ${mask(`$${fmt(budget.annualBudget, 0)}`)}`
            }
            color={budget.remaining < 0 ? "orange" : undefined}
          />
          <StatTile
            label="On pace to date"
            value={mask(`$${fmt(budget.onPaceSpend, 0)}`)}
            sub={`${fmt(budget.yearElapsed * 100, 0)}% of the year gone`}
          />
          <StatTile
            label="Annual budget"
            value={mask(`$${fmt(budget.annualBudget, 0)}`)}
            sub={`${fmt(budgetPct, 1)}% of account`}
          />
        </SimpleGrid>

        <Stack gap="sm" mt="lg">
          <SpendBar
            label="This quarter"
            spent={quarterSpent}
            budget={budget.annualBudget / 4}
            color={color}
            mask={mask}
          />
          <SpendBar
            label="This year"
            spent={budget.spent}
            budget={budget.annualBudget}
            color={color}
            mask={mask}
            marks={QUARTER_MARKS}
          />
        </Stack>

        {lots.length > 0 && (
          <Accordion chevronPosition="left" mt="md" styles={{ content: { padding: 0 } }}>
            <Accordion.Item value="spend" style={{ border: "none" }}>
              <Accordion.Control px={0}>
                <Text size="sm" fw={600}>
                  Where it went — {lots.length - excludedHere} of {lots.length} contract
                  {lots.length === 1 ? "" : "s"} counted
                </Text>
              </Accordion.Control>
              <Accordion.Panel>
                <Table.ScrollContainer minWidth={720}>
                  <Table verticalSpacing="xs" fz="sm">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th w={36} />
                        <Table.Th>Contract</Table.Th>
                        <Table.Th ta="right">Ct</Table.Th>
                        <Table.Th ta="right">DTE</Table.Th>
                        <Table.Th ta="right">Held</Table.Th>
                        <Table.Th ta="right">Open</Table.Th>
                        <Table.Th ta="right">Close</Table.Th>
                        <Table.Th ta="right">Value</Table.Th>
                        <Table.Th ta="right">Net</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {lots.map((lot) => {
                        const off = excluded.has(lot.symbol);
                        return (
                          <Table.Tr key={lot.symbol} style={{ opacity: off ? 0.45 : 1 }}>
                            <Table.Td>
                              <Checkbox
                                size="xs"
                                color={color}
                                checked={!off}
                                onChange={() => toggleLot(lot.symbol)}
                                aria-label={`Count ${lot.symbol} against the hedge budget`}
                              />
                            </Table.Td>
                            <Table.Td>
                              <Text
                                size="sm"
                                td={off ? "line-through" : undefined}
                                style={{
                                  color: lot.underlyingSymbol.includes("VIX")
                                    ? VIX_MARK
                                    : PUT_MARK,
                                }}
                              >
                                {lot.underlyingSymbol}
                                {lot.strike != null &&
                                  ` $${fmt(lot.strike, 0)}${lot.putCall === "PUT" ? "P" : "C"}`}
                              </Text>
                              <Text size="xs" c="dimmed">
                                {lot.expiry ?? "—"} exp
                                {lot.openedAt ? ` · opened ${lot.openedAt.slice(0, 10)}` : ""}
                              </Text>
                            </Table.Td>
                            <Table.Td ta="right" c="dimmed">
                              {lot.openContracts > 0 && lot.closedContracts > 0
                                ? `${lot.openContracts}/${lot.contracts}`
                                : lot.contracts || lot.closedContracts}
                            </Table.Td>
                            <Table.Td ta="right" c="dimmed">
                              {lot.openDte != null ? `${lot.openDte}d` : "—"}
                            </Table.Td>
                            <Table.Td
                              ta="right"
                              c={lot.daysHeld != null && lot.daysHeld <= 2 ? "orange" : "dimmed"}
                            >
                              {lot.daysHeld != null
                                ? `${lot.daysHeld}d${lot.openContracts > 0 ? "…" : ""}`
                                : "—"}
                            </Table.Td>
                            <Table.Td ta="right">
                              {lot.openPrice != null ? `$${fmt(lot.openPrice, 2)}` : "—"}
                            </Table.Td>
                            <Table.Td ta="right">
                              {lot.closePrice != null ? (
                                `$${fmt(lot.closePrice, 2)}`
                              ) : (
                                <Text size="sm" c="dimmed" component="span">
                                  open
                                </Text>
                              )}
                            </Table.Td>
                            <Table.Td ta="right" c={lot.openContracts > 0 ? undefined : "dimmed"}>
                              {lot.openValue == null
                                ? "—"
                                : lot.openContracts === 0
                                  ? "closed"
                                  : mask(`$${fmt(lot.openValue, 0)}`)}
                            </Table.Td>
                            <Table.Td
                              ta="right"
                              fw={600}
                              c={lot.net == null ? "dimmed" : lot.net >= 0 ? "teal" : "red"}
                            >
                              {lot.net == null
                                ? "—"
                                : mask(`${lot.net >= 0 ? "+" : "−"}$${fmt(Math.abs(lot.net), 0)}`)}
                            </Table.Td>
                          </Table.Tr>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
                <Text size="xs" c="dimmed" mt="xs">
                  Listed here: VIX in any form at any tenor, plus QQQ and TQQQ puts you{" "}
                  <b>bought</b> at least {MIN_HEDGE_DTE} days from expiry. The ladder&apos;s short
                  options never appear, and neither do weekly or 0DTE puts — those are trades, not
                  insurance. Untick anything else that wasn&apos;t really the hedge and it drops
                  out of the spend above; the choice sticks per account. DTE is the tenor it was
                  bought at and Held how long it ran — a long tenor closed in a day or two is a
                  trade wearing a hedge&apos;s clothes. Open and close are per share, fees
                  included.
                </Text>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        )}
      </Paper>

      {/* ── controls ─────────────────────────────────────────────────────── */}
      <Paper p="lg" radius={CARD_RADIUS} style={{ background: cardBg }}>
        <Accordion chevronPosition="left" styles={{ content: { padding: 0 } }}>
          <Accordion.Item value="settings" style={{ border: "none" }}>
            <Accordion.Control px={0} icon={<IconSettings size={16} />}>
              <Text size="sm" fw={600}>
                Settings
              </Text>
              {/* Collapsed, the control still answers what the program is set to. */}
              <Text size="xs" c="dimmed">
                {fmt(budgetPct, 1)}%/yr · {putShare}/{100 - putShare} split · Δ
                {fmt(targetDelta / 100, 2)} at {dteNum}d · VIX +{vixStrikeOffset} at {vixDteNum}d
              </Text>
            </Accordion.Control>
            <Accordion.Panel>
              <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xl">
                <Box>
                  <Group justify="space-between" mb={4}>
                    <Text size="sm" fw={600}>
                      Annual budget
                    </Text>
                    <Badge color={color} variant="light">
                      {fmt(budgetPct, 1)}%
                    </Badge>
                  </Group>
                  <Slider
                    color={color}
                    mb={SLIDER_MB}
                    min={0.5}
                    max={10}
                    step={0.5}
                    value={budgetPct}
                    onChange={(v) => set("budgetPct", v)}
                    onChangeEnd={(v) => commitKey("budgetPct", v)}
                    marks={[
                      { value: 3, label: "3%" },
                      { value: 6, label: "6%" },
                    ]}
                  />
                  <Text size="xs" c="dimmed" mt={6}>
                    {mask(`$${fmt(budget.annualBudget, 0)}`)}/yr on a {mask(`$${fmt(accountValue, 0)}`)}{" "}
                    account.
                  </Text>
                </Box>

                <Box>
                  <Group justify="space-between" mb={4}>
                    <Text size="sm" fw={600}>
                      Puts / VIX split
                    </Text>
                    <Badge color={color} variant="light">
                      {putShare} / {100 - putShare}
                    </Badge>
                  </Group>
                  <Slider
                    color={color}
                    mb={SLIDER_MB}
                    min={50}
                    max={100}
                    step={5}
                    value={putShare}
                    onChange={(v) => set("putSharePct", v)}
                    onChangeEnd={(v) => commitKey("putSharePct", v)}
                    marks={[
                      { value: 70, label: "70/30" },
                      { value: 80, label: "80/20" },
                      { value: 100, label: "all puts" },
                    ]}
                  />
                  <Text size="xs" c="dimmed" mt={6}>
                    Your ladder scales <b>down</b> per level, so its worst losses are not from doubling
                    into a fast move — that argues for a smaller VIX sleeve.
                  </Text>
                </Box>
              </SimpleGrid>

              <Box mt="lg" p="md" style={{ background: putBg, borderRadius: CARD_RADIUS }}>
                <Text tt="uppercase" mb="md" style={{ ...CARD_LABEL_STYLE, color: layerInk("put") }}>
                  Put layer
                </Text>

              <SimpleGrid cols={{ base: 1, md: 3 }} spacing="xl">
                <Box>
                  <Group justify="space-between" mb={4}>
                    <Text size="sm" fw={600}>
                      Put delta
                    </Text>
                    <Badge color={PUT_COLOR} variant="light">
                      {fmt(targetDelta / 100, 2)}
                    </Badge>
                  </Group>
                  <Slider
                    color={PUT_COLOR}
                    mb={SLIDER_MB}
                    min={3}
                    max={35}
                    step={1}
                    value={targetDelta}
                    onChange={(v) => set("putDelta", v)}
                    onChangeEnd={(v) => commitKey("putDelta", v)}
                    marks={[
                      { value: 5, label: "0.05" },
                      { value: 10, label: "0.10" },
                      { value: 25, label: "0.25" },
                    ]}
                  />
                  <Text size="xs" c="dimmed" mt={6}>
                    Lower delta buys more contracts further out — better in a crash, worse in a dip.
                  </Text>
                </Box>

                <Box>
                  <Text size="sm" fw={600} mb={6}>
                    Put expiry
                  </Text>
                  <SegmentedControl
                    fullWidth
                    color={PUT_COLOR}
                    value={dte}
                    onChange={(v) => commitKey("putDte", Number(v))}
                    data={DTE_CHOICES.map((d) => ({ value: d, label: `${d}d` }))}
                  />
                  <Text size="xs" c="dimmed" mt={6}>
                    {fmt(365 / dteNum, 1)} rolls a year.
                  </Text>
                </Box>

                <Box>
                  <Group justify="space-between" mb={4}>
                    <Text size="sm" fw={600}>
                      Drift band
                    </Text>
                    <Badge color={PUT_COLOR} variant="light">
                      ±{driftBandPct}%
                    </Badge>
                  </Group>
                  <Slider
                    color={PUT_COLOR}
                    mb={SLIDER_MB}
                    min={0}
                    max={60}
                    step={5}
                    value={driftBandPct}
                    onChange={(v) => set("driftBandPct", v)}
                    onChangeEnd={(v) => commitKey("driftBandPct", v)}
                    marks={[
                      { value: 0, label: "exact" },
                      { value: 25, label: "25%" },
                    ]}
                  />
                  <Text size="xs" c="dimmed" mt={6}>
                    How far coverage may drift before trading. Wider means fewer spreads paid.
                  </Text>
                </Box>
              </SimpleGrid>
              </Box>

              <Box mt="lg" p="md" style={{ background: vixBg, borderRadius: CARD_RADIUS }}>
                <Text tt="uppercase" mb="md" style={{ ...CARD_LABEL_STYLE, color: layerInk("vix") }}>
                  VIX sleeve
                </Text>

              <SimpleGrid cols={{ base: 1, sm: 2, lg: 5 }} spacing="lg">
                <Box>
                  <Text size="sm" fw={600} mb={6}>
                    VIX expiry
                  </Text>
                  <SegmentedControl
                    fullWidth
                    color={VIX_COLOR}
                    value={vixDte}
                    onChange={(v) => commitKey("vixDte", Number(v))}
                    data={["30", "45", "60"].map((d) => ({ value: d, label: `${d}d` }))}
                  />
                  <Text size="xs" c="dimmed" mt={6}>
                    Forward {vixPlan ? fmt(vixPlan.forward, 1) : "—"} vs spot {fmt(vix ?? 0, 1)}
                    {vix != null && vix3m != null
                      ? vix3m > vix
                        ? " (contango — the forward costs more)"
                        : " (backwardation)"
                      : ""}
                  </Text>
                </Box>
                <Box>
                  <Group justify="space-between" mb={4}>
                    <Text size="sm" fw={600}>
                      Strike above forward
                    </Text>
                    <Badge color={VIX_COLOR} variant="light">
                      +{vixStrikeOffset}
                    </Badge>
                  </Group>
                  <Slider
                    color={VIX_COLOR}
                    mb={SLIDER_MB}
                    min={0}
                    max={30}
                    step={1}
                    value={vixStrikeOffset}
                    onChange={(v) => set("vixStrikeOffset", v)}
                    onChangeEnd={(v) => commitKey("vixStrikeOffset", v)}
                    marks={[
                      { value: 5, label: "+5" },
                      { value: 15, label: "+15" },
                    ]}
                  />
                </Box>

                <Box>
                  <Group justify="space-between" mb={4}>
                    <Text size="sm" fw={600}>
                      Vol of vol
                    </Text>
                    <Badge color={VIX_COLOR} variant="light">
                      {volOfVol}%
                    </Badge>
                  </Group>
                  <Slider
                    color={VIX_COLOR}
                    mb={SLIDER_MB}
                    min={40}
                    max={160}
                    step={5}
                    value={volOfVol}
                    onChange={(v) => set("volOfVol", v)}
                    onChangeEnd={(v) => commitKey("volOfVol", v)}
                    marks={[
                      { value: 90, label: "90%" },
                      { value: 130, label: "130%" },
                    ]}
                  />
                  <Text size="xs" c="dimmed" mt={6}>
                    Pricing input only. Raise it to see richer premiums.
                  </Text>
                </Box>

                <Box>
                  <Group justify="space-between" mb={4}>
                    <Text size="sm" fw={600}>
                      No new entries above
                    </Text>
                    <Badge color={vix != null && vix >= maxEntryVix ? "yellow" : color} variant="light">
                      VIX {maxEntryVix}
                    </Badge>
                  </Group>
                  <Slider
                    color={VIX_COLOR}
                    mb={SLIDER_MB}
                    min={12}
                    max={45}
                    step={1}
                    value={maxEntryVix}
                    onChange={(v) => set("maxEntryVix", v)}
                    onChangeEnd={(v) => commitKey("maxEntryVix", v)}
                    marks={[
                      { value: 20, label: "20" },
                      { value: 30, label: "30" },
                    ]}
                  />
                  <Text size="xs" c="dimmed" mt={6}>
                    Vol is already priced up here — adding is paying peak premium for a move underway.
                  </Text>
                </Box>

                <Box>
                  <Group justify="space-between" mb={4}>
                    <Text size="sm" fw={600}>
                      Harvest above
                    </Text>
                    <Badge color={VIX_COLOR} variant="light">
                      VIX {monetizeVix}
                    </Badge>
                  </Group>
                  <Slider
                    color={VIX_COLOR}
                    mb={SLIDER_MB}
                    min={25}
                    max={80}
                    step={1}
                    value={monetizeVix}
                    onChange={(v) => set("monetizeVix", v)}
                    onChangeEnd={(v) => commitKey("monetizeVix", v)}
                    marks={[
                      { value: 40, label: "40" },
                      { value: 60, label: "60" },
                    ]}
                  />
                  <Text size="xs" c="dimmed" mt={6}>
                    Spikes mean-revert within days. Unharvested convexity is worth nothing.
                  </Text>
                </Box>
              </SimpleGrid>
              </Box>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </Paper>

      {/* ── what it does, per real episode ───────────────────────────────── */}
      <Paper p="lg" radius={CARD_RADIUS} style={{ background: cardBg }}>
        <Text fw={600} mb={4}>
          If each of these happened again
        </Text>
        <Text size="xs" c="dimmed" mb="md">
          Real drawdowns and real peak VIX from each episode. Puts are marked with that episode&apos;s
          vol and whatever time was left, which is why they pay far more than intrinsic. Note the
          deepest drawdown printed the <b>weakest</b> VIX — the slow grind is what neither layer
          covers.
        </Text>
        <Table verticalSpacing="xs" fz="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Episode</Table.Th>
              <Table.Th ta="right">TQQQ</Table.Th>
              <Table.Th ta="right">VIX</Table.Th>
              <Table.Th ta="right">Shares</Table.Th>
              <Table.Th ta="right" style={{ color: PUT_MARK }}>
                Puts
              </Table.Th>
              <Table.Th ta="right" style={{ color: VIX_MARK }}>
                VIX calls
              </Table.Th>
              <Table.Th ta="right">Offset</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {episodes.map((e) => (
              <Table.Tr key={e.label}>
                <Table.Td>{e.label}</Table.Td>
                <Table.Td ta="right" c="dimmed">
                  {fmt(e.tqqqMove * 100, 0)}%
                </Table.Td>
                <Table.Td ta="right" c="dimmed">
                  {fmt(e.vixPeak, 0)}
                </Table.Td>
                <Table.Td ta="right" c="red">
                  {mask(`−$${fmt(Math.abs(e.sharesPl), 0)}`)}
                </Table.Td>
                <Table.Td ta="right" c={e.putPl >= 0 ? "teal" : undefined}>
                  {mask(`${e.putPl >= 0 ? "+" : "−"}$${fmt(Math.abs(e.putPl), 0)}`)}
                </Table.Td>
                <Table.Td ta="right" c={e.vixPl > 0 ? "teal" : undefined}>
                  {vixPlan ? mask(`${e.vixPl >= 0 ? "+" : "−"}$${fmt(Math.abs(e.vixPl), 0)}`) : "—"}
                </Table.Td>
                <Table.Td ta="right" fw={600} c={e.offsetPct > 25 ? "teal" : "dimmed"}>
                  {fmt(e.offsetPct, 0)}%
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>

        <Divider my="md" />

        <Text size="xs" c="dimmed" mb="sm">
          Put layer at expiry, intrinsic only — the floor, before any vol response.
        </Text>
        <Box h={isMobile ? 240 : 300}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={curve}
              margin={{ top: 12, right: 12, bottom: 8, left: isMobile ? -12 : 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--mantine-color-dark-4)" />
              <XAxis
                dataKey="tqqqPct"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                stroke="var(--mantine-color-dimmed)"
                fontSize={11}
              />
              <YAxis
                tickFormatter={(v: number) => (privacyMode ? "" : `$${(v / 1000).toFixed(0)}k`)}
                stroke="var(--mantine-color-dimmed)"
                fontSize={11}
              />
              <ChartTooltip
                contentStyle={{
                  background: "var(--mantine-color-dark-7)",
                  border: "1px solid var(--mantine-color-dark-4)",
                  borderRadius: 12,
                  fontSize: 12,
                }}
                labelFormatter={(l) => `TQQQ ${Number(l).toFixed(0)}%`}
                formatter={(value, name) => [mask(`$${fmt(Number(value), 0)}`), String(name)]}
              />
              <ReferenceLine y={0} stroke="var(--mantine-color-dark-3)" />
              <ReferenceLine
                x={((putPlan.strike - tqqqSpot) / tqqqSpot) * 100}
                stroke={PUT_MARK}
                strokeDasharray="4 4"
                label={{
                  value: `put $${fmt(putPlan.strike, 0)}`,
                  position: "top",
                  fill: PUT_MARK,
                  fontSize: 10,
                }}
              />
              <Line
                type="monotone"
                dataKey="sharesPl"
                stroke="var(--mantine-color-gray-5)"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
                isAnimationActive={false}
                name="Shares alone"
              />
              <Line
                type="monotone"
                dataKey="net"
                stroke={PUT_MARK}
                strokeWidth={2.5}
                dot={false}
                isAnimationActive={false}
                name="Shares + puts"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </Box>
      </Paper>
    </Stack>
  );
}
