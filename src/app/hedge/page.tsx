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
  Progress,
  ThemeIcon,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconShieldCheck,
  IconShoppingCart,
  IconTrash,
  IconCheck,
  IconLock,
} from "@tabler/icons-react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ChartTooltip,
  ReferenceLine,
} from "recharts";
import { useApp } from "@/lib/context/AppContext";
import { useBalances } from "@/lib/hooks/useBalances";
import { useAccountColor } from "@/lib/hooks/useAccountColor";
import { useCardBg } from "@/lib/hooks/useCardBg";
import { CARD_RADIUS, CARD_LABEL_STYLE } from "@/lib/cardStyles";
import { createMask, fmt } from "@/lib/format";
import {
  planProgram,
  scenarioTable,
  hedgeSpendSince,
  budgetStatus,
  tqqqIvFromVxn,
  type RebalanceAction,
} from "@/lib/putProgram";
import { planVixLayer, vixPayoff, EPISODES } from "@/lib/vixLayer";
import { mergeHedgeSettings, type HedgeSettings } from "@/lib/hedgeSettings";

const DTE_CHOICES = ["30", "45", "60", "90"];

/**
 * Mantine positions slider mark labels absolutely, so they reserve no layout
 * height and would sit on top of the caption below.
 */
const SLIDER_MB = 26;

const ACTION_STYLE: Record<
  RebalanceAction,
  { color: string; label: string; Icon: typeof IconCheck }
> = {
  buy: { color: "teal", label: "Buy", Icon: IconShoppingCart },
  sell: { color: "orange", label: "Sell", Icon: IconTrash },
  hold: { color: "gray", label: "Hold", Icon: IconCheck },
};

function StatTile({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <Box>
      <Text c="dimmed" tt="uppercase" style={CARD_LABEL_STYLE}>
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

function ActionCard({
  title,
  action,
  headline,
  detail,
  note,
  cost,
  costLabel,
  gated,
  cardBg,
  mask,
}: {
  title: string;
  action: RebalanceAction;
  headline: string;
  detail: string;
  note?: string;
  cost: number;
  costLabel: string;
  gated?: boolean;
  cardBg: string;
  mask: (s: string) => string;
}) {
  const act = ACTION_STYLE[action];
  const Icon = gated ? IconLock : act.Icon;
  return (
    <Paper p="lg" radius={CARD_RADIUS} style={{ background: cardBg }}>
      <Group justify="space-between" align="flex-start" wrap="nowrap" mb="xs">
        <Text c="dimmed" tt="uppercase" style={CARD_LABEL_STYLE}>
          {title}
        </Text>
        <Text size="xs" c="dimmed">
          {costLabel} {mask(`$${fmt(cost, 0)}`)}
        </Text>
      </Group>
      <Group gap="md" wrap="nowrap">
        <ThemeIcon size={44} radius="xl" color={gated ? "yellow" : act.color} variant="light">
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
        </Box>
      </Group>
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
  } = draft;
  const dte = String(draft.putDte);
  const vixDte = String(draft.vixDte);

  // ── live inputs ────────────────────────────────────────────────────────────
  const [vxn, setVxn] = useState<number | null>(null);
  const [vix, setVix] = useState<number | null>(null);
  const [vix3m, setVix3m] = useState<number | null>(null);
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
      const [iv, v, v3] = await Promise.all([
        num("/api/iv-rank", "vxnPct"),
        num("/api/quote?symbol=%5EVIX", "price"),
        num("/api/quote?symbol=%5EVIX3M", "price"),
      ]);
      if (cancelled) return;
      setVxn(iv);
      setVix(v);
      setVix3m(v3);
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

  /** Long TQQQ puts are the hedge; short ones belong to the options ladder. */
  const currentPuts = useMemo(
    () =>
      optionPositions
        .filter((p) => p.underlyingSymbol === "TQQQ" && p.putCall === "PUT" && p.longQty > 0)
        .reduce((sum, p) => sum + p.longQty, 0),
    [optionPositions],
  );

  const currentVixCalls = useMemo(
    () =>
      optionPositions
        .filter(
          (p) =>
            p.underlyingSymbol.includes("VIX") && p.putCall === "CALL" && p.longQty > 0,
        )
        .reduce((sum, p) => sum + p.longQty, 0),
    [optionPositions],
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
      currentContracts: currentPuts,
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
    currentPuts,
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
      currentContracts: currentVixCalls,
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
    currentVixCalls,
  ]);

  const yearStart = useMemo(() => new Date(new Date().getFullYear(), 0, 1), []);
  const spent = useMemo(
    () => hedgeSpendSince(filledOptionOrders, yearStart, ["TQQQ", "VIX", "$VIX"]),
    [filledOptionOrders, yearStart],
  );
  const budget = useMemo(
    () => budgetStatus(accountValue * (budgetPct / 100), spent),
    [accountValue, budgetPct, spent],
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

  const pacePct = budget.annualBudget > 0 ? (budget.spent / budget.annualBudget) * 100 : 0;
  const totalCycleCost = putPlan.cycleCost + (vixPlan?.cycleCost ?? 0);

  return (
    <Stack gap="md">
      <Text fw={700} size="xl">
        Hedge
      </Text>

      <Alert
        icon={<IconShieldCheck size={18} />}
        color={color}
        radius={CARD_RADIUS}
        title={`${fmt(budgetPct, 1)}% of account per year, split ${putShare}/${100 - putShare}`}
      >
        <Text size="sm">
          <b>TQQQ puts</b> — budget sets the size, delta sets the strike. On TQQQ rather than QQQ
          because one contract covers exactly 100 shares, so coverage tracks the ladder as it fills.
          <br />
          <b>VIX calls</b> — the convex sleeve, bought only when vol is cheap. New positions are
          blocked above VIX {maxEntryVix} and flagged for harvest above {monetizeVix}: buying a
          spike is how tail insurance loses money.
        </Text>
      </Alert>

      {/* ── this week's actions ──────────────────────────────────────────── */}
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <ActionCard
          title="Put layer"
          action={putPlan.action}
          headline={
            putPlan.action === "hold"
              ? "Hold — inside the band"
              : `${ACTION_STYLE[putPlan.action].label} ${putPlan.actionContracts} TQQQ put${putPlan.actionContracts === 1 ? "" : "s"}`
          }
          detail={`$${fmt(putPlan.strike, 0)} strike · ${dteNum}d · Δ${fmt(Math.abs(putPlan.delta), 2)} · ${fmt(putPlan.otmPct, 1)}% OTM`}
          note={`Holding ${currentPuts}, target ${putPlan.targetContracts} · drift ${fmt(putPlan.driftPct, 0)}% vs ${driftBandPct}% band`}
          cost={putPlan.cycleCost}
          costLabel="cycle"
          cardBg={cardBg}
          mask={mask}
        />
        {vixPlan ? (
          <ActionCard
            title="VIX layer"
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
            costLabel="cycle"
            gated={vixPlan.gated && !vixPlan.monetize}
            cardBg={cardBg}
            mask={mask}
          />
        ) : (
          <Paper p="lg" radius={CARD_RADIUS} style={{ background: cardBg }}>
            <Text c="dimmed" tt="uppercase" style={CARD_LABEL_STYLE} mb="xs">
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

      {/* ── modeling caveat ──────────────────────────────────────────────── */}
      {vixPlan && (
        <Alert color="yellow" variant="light" radius={CARD_RADIUS} icon={<IconAlertTriangle size={16} />}>
          <Text size="xs">
            VIX premiums here are <b>indicative, not quotes</b>. VIX options settle on VIX futures,
            which this app does not have — the forward is interpolated from ^VIX and ^VIX3M, and
            Black-76 understates far-OTM calls because it misses VIX&apos;s mean reversion and skew.
            Size from your broker&apos;s real quotes; the budget tracker uses your actual fills.
          </Text>
        </Alert>
      )}

      {/* ── controls ─────────────────────────────────────────────────────── */}
      <Paper p="lg" radius={CARD_RADIUS} style={{ background: cardBg }}>
        <SimpleGrid cols={{ base: 1, md: 3 }} spacing="xl">
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

          <Box>
            <Group justify="space-between" mb={4}>
              <Text size="sm" fw={600}>
                Put delta
              </Text>
              <Badge color={color} variant="light">
                {fmt(targetDelta / 100, 2)}
              </Badge>
            </Group>
            <Slider
              color={color}
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
              color={color}
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
              <Badge color={color} variant="light">
                ±{driftBandPct}%
              </Badge>
            </Group>
            <Slider
              color={color}
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

          <Box>
            <Text size="sm" fw={600} mb={6}>
              VIX expiry
            </Text>
            <SegmentedControl
              fullWidth
              color={color}
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
        </SimpleGrid>

        <Divider my="lg" label="VIX sleeve" labelPosition="left" />

        <SimpleGrid cols={{ base: 1, md: 4 }} spacing="xl">
          <Box>
            <Group justify="space-between" mb={4}>
              <Text size="sm" fw={600}>
                Strike above forward
              </Text>
              <Badge color={color} variant="light">
                +{vixStrikeOffset}
              </Badge>
            </Group>
            <Slider
              color={color}
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
              <Badge color={color} variant="light">
                {volOfVol}%
              </Badge>
            </Group>
            <Slider
              color={color}
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
              color={color}
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
              <Badge color={color} variant="light">
                VIX {monetizeVix}
              </Badge>
            </Group>
            <Slider
              color={color}
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
        <Progress.Root size="xl" radius="xl">
          <Progress.Section
            value={Math.min(100, pacePct)}
            color={budget.overPace > 0 ? "orange" : color}
          >
            <Progress.Label>{fmt(pacePct, 0)}%</Progress.Label>
          </Progress.Section>
        </Progress.Root>
        <Group justify="space-between" mt="xs">
          <Text size="xs" c="dimmed">
            Spent {mask(`$${fmt(budget.spent, 0)}`)} of {mask(`$${fmt(budget.annualBudget, 0)}`)} ·
            long-side fills only
          </Text>
          <Text size="xs" c="dimmed">
            {fmt(budget.yearElapsed * 100, 0)}% of the year gone
          </Text>
        </Group>
      </Paper>

      {/* ── sizing ───────────────────────────────────────────────────────── */}
      <Paper p="lg" radius={CARD_RADIUS} style={{ background: cardBg }}>
        <SimpleGrid cols={{ base: 2, md: 4 }} spacing="lg">
          <StatTile
            label="Put target"
            value={`${putPlan.targetContracts} ct`}
            sub={putPlan.binding === "budget" ? "budget-capped" : "share-count-capped"}
            color={putPlan.binding === "budget" ? "orange" : undefined}
          />
          <StatTile
            label="Coverage"
            value={`${fmt(putPlan.coveragePct, 0)}%`}
            sub={`of ${tqqqShares} shares`}
          />
          <StatTile
            label="VIX target"
            value={vixPlan ? `${vixPlan.targetContracts} ct` : "—"}
            sub={vixPlan?.gated ? "gated" : "convex sleeve"}
            color={vixPlan?.gated ? "yellow" : undefined}
          />
          <StatTile
            label="Combined carry"
            value={`${fmt(((totalCycleCost * (365 / dteNum)) / accountValue) * 100, 2)}%`}
            sub="of account per year"
          />
        </SimpleGrid>
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
              <Table.Th ta="right">Puts</Table.Th>
              <Table.Th ta="right">VIX calls</Table.Th>
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
                stroke="var(--mantine-color-teal-5)"
                strokeDasharray="4 4"
                label={{
                  value: `put $${fmt(putPlan.strike, 0)}`,
                  position: "top",
                  fill: "var(--mantine-color-teal-5)",
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
                stroke="var(--mantine-color-teal-4)"
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
