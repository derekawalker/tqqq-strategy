"use client";

import { useMemo, useState, Suspense } from "react";
import {
  Text,
  Stack,
  Group,
  Paper,
  Box,
  Skeleton,
  ScrollArea,
  Switch,
} from "@mantine/core";
import { Outfit } from "next/font/google";
import { useApp } from "@/lib/context/AppContext";
import type { Account } from "@/lib/context/AppContext";
import type { FilledOrder, WorkingOrder } from "@/lib/schwab/parse";
import type { AccountBalance } from "@/app/api/schwab/data/route";
import { computeLevels, matchLevel } from "@/lib/levels";
import type { Level } from "@/lib/levels";
import { fmt, createMask, toDateKey } from "@/lib/format";
import { useCardBg } from "@/lib/hooks/useCardBg";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { CARD_RADIUS, CARD_LABEL_STYLE } from "@/lib/cardStyles";

const outfit = Outfit({ subsets: ["latin"] });

const COLUMN_WIDTH = 260;

// ── segment config (matches AccountValueCard) ─────────────────────────────

const SEGMENTS = [
  { key: "tqqqValue", label: "TQQQ", color: "#339af0" },
  { key: "moneyMarketValue", label: "SWVXX & SGOV", color: "#51cf66" },
  { key: "optionsValue", label: "Options", color: "#cc5de8" },
  { key: "cash", label: "Cash", color: "#fcc419" },
  { key: "otherValue", label: "Other", color: "#868e96" },
] as const;
type SegmentKey = (typeof SEGMENTS)[number]["key"];

// ── data types ────────────────────────────────────────────────────────────

interface AccountData {
  account: Account;
  balance: AccountBalance | null;
  levels: Level[];
  currentLevel: number | null; // null = settings not configured
  tqqqShares: number;
  openOptions: number;
  tradesToday: number;
  pendingBuyCost: number | null;
  cspCollateral: number | null;
  gain: number | null;
  gainPct: number | null;
  annualROI: number | null;
}

// ── per-account computation helpers ──────────────────────────────────────

function buildLevelsAndCurrentLevel(
  account: Account,
  filledOrders: FilledOrder[],
): { levels: Level[]; currentLevel: number | null } {
  const s = account.settings;
  if (
    !s.levelStartingCash ||
    !s.initialLotPrice ||
    !s.sellPercentage ||
    !s.reductionFactor
  ) {
    return { levels: [], currentLevel: null };
  }
  const levels = computeLevels(
    s.levelStartingCash,
    s.initialLotPrice,
    s.sellPercentage,
    s.reductionFactor,
  );
  if (levels.every((l) => l.shares === 0))
    return { levels: [], currentLevel: null };

  const resetDate = s.levelResetDate ?? null;
  const orders = filledOrders.filter(
    (o) => o.accountNumber === account.accountNumber,
  );
  const relevant = resetDate
    ? orders.filter((o) => new Date(o.time) >= resetDate)
    : orders;

  const lastFillSide = new Map<number, "BUY" | "SELL">();
  for (const o of relevant) {
    const idx = matchLevel(levels, o.shares, o.fillPrice);
    if (idx === -1) continue;
    if (!lastFillSide.has(idx)) lastFillSide.set(idx, o.side);
  }

  const ownedIndices = new Set(
    [...lastFillSide.entries()]
      .filter(([, side]) => side === "BUY")
      .map(([i]) => i),
  );
  let currentLevel = ownedIndices.size > 0 ? Math.max(...ownedIndices) : -1;

  for (const o of relevant) {
    if (o.side !== "SELL") continue;
    const idx = matchLevel(levels, o.shares, o.fillPrice);
    if (idx === -1) continue;
    if (currentLevel >= idx) currentLevel = idx - 1;
    break;
  }

  return { levels, currentLevel };
}

function buildPendingBuyCost(
  account: Account,
  workingOrders: WorkingOrder[],
  levels: Level[],
  ownedLevels: Set<number>,
): number | null {
  if (levels.length === 0) return null;
  const shareToIdx = new Map(levels.map((l, i) => [l.shares, i]));
  const accountBuys = workingOrders.filter(
    (o) => o.accountNumber === account.accountNumber && o.side === "BUY",
  );

  const counts = new Map<number, { buys: number; buyPrice: number | null }>();
  for (const o of accountBuys) {
    const idx = shareToIdx.get(o.shares) ?? -1;
    const buyPrice = idx >= 0 ? levels[idx].buyPrice : null;
    const existing = counts.get(o.shares);
    counts.set(o.shares, { buys: (existing?.buys ?? 0) + 1, buyPrice });
  }

  let total = 0;
  for (const [shares, { buys, buyPrice }] of counts) {
    if (buys === 0 || buyPrice == null) continue;
    const idx = shareToIdx.get(shares) ?? -1;
    if (idx >= 0 && ownedLevels.has(idx)) continue;
    total += shares * buyPrice;
  }
  return total;
}

// ── widgets ───────────────────────────────────────────────────────────────

function CardLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text
      c="dimmed"
      tt="uppercase"
      fw={600}
      ta="center"
      w="100%"
      style={CARD_LABEL_STYLE}
    >
      {children}
    </Text>
  );
}

function AccountValueWidget({
  balance,
  pendingBuyCost,
  cspCollateral,
  color,
  mask,
}: {
  balance: AccountBalance | null;
  pendingBuyCost: number | null;
  cspCollateral: number | null;
  color: string;
  mask: (s: string) => string;
}) {
  const bg = useCardBg(color);
  const total = balance?.totalValue ?? 0;
  const segments = SEGMENTS.map((s) => ({
    ...s,
    value: balance ? (balance[s.key as SegmentKey] as number) : 0,
  }));

  return (
    <Paper p="md" radius={CARD_RADIUS} style={{ background: bg }}>
      <Stack gap="md">
        <CardLabel>Account Value</CardLabel>
        <AnimatedNumber
          value={mask(`$${fmt(total, 0)}`)}
          className={outfit.className}
          style={{
            fontSize: "2.25rem",
            fontWeight: 700,
            lineHeight: 1,
            color: "white",
          }}
        />
        <Box
          style={{
            display: "flex",
            height: 14,
            borderRadius: 4,
            overflow: "hidden",
            background: "var(--mantine-color-dark-4)",
          }}
        >
          {total > 0 &&
            segments.map((s) => {
              const pct = (s.value / total) * 100;
              if (pct < 0.1) return null;
              return (
                <Box
                  key={s.key}
                  style={{
                    width: `${pct}%`,
                    height: "100%",
                    background: s.color,
                    flexShrink: 0,
                  }}
                />
              );
            })}
        </Box>
        <Stack gap={4}>
          {segments.map((s) => {
            const pct = total > 0 ? (s.value / total) * 100 : 0;
            if (s.value === 0 && pct === 0) return null;
            return (
              <Group key={s.key} justify="space-between" wrap="nowrap">
                <Group gap={6} wrap="nowrap">
                  <Box
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 2,
                      background: s.color,
                      flexShrink: 0,
                    }}
                  />
                  <Text size="xs" c="dimmed">
                    {s.label}
                  </Text>
                </Group>
                <Group gap={6} wrap="nowrap">
                  <Text size="xs" fw={500}>
                    {mask(`$${fmt(s.value, 0)}`)}
                  </Text>
                  <Text size="xs" c="dimmed" w={36} ta="right">
                    {fmt(pct, 1)}%
                  </Text>
                </Group>
              </Group>
            );
          })}
        </Stack>
        <Stack gap={4} mt="auto">
          <Box
            style={{ height: 1, background: "var(--mantine-color-dark-4)" }}
          />
          {cspCollateral != null && (
            <Group justify="space-between">
              <Text size="xs" c="dimmed">
                CSP collateral
              </Text>
              <Text size="xs" fw={600} c="grape">
                {mask(`$${fmt(cspCollateral, 0)}`)}
              </Text>
            </Group>
          )}
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              Pending trades
            </Text>
            <Text size="xs" fw={600} c="orange">
              {pendingBuyCost != null
                ? mask(`$${fmt(pendingBuyCost, 0)}`)
                : "—"}
            </Text>
          </Group>
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              Available cash
            </Text>
            <Text size="xs" fw={600} c="teal">
              {balance != null
                ? mask(`$${fmt(balance.cashAvailableForTrading, 0)}`)
                : "—"}
            </Text>
          </Group>
        </Stack>
      </Stack>
    </Paper>
  );
}

function LevelWidget({
  levels,
  currentLevel,
  color,
}: {
  levels: Level[];
  currentLevel: number | null;
  color: string;
}) {
  const bg = useCardBg(color);
  const window = 4;

  if (currentLevel == null || currentLevel < 0 || levels.length === 0) {
    return (
      <Paper p="md" radius={CARD_RADIUS} style={{ background: bg }}>
        <Stack align="center" gap={8}>
          <CardLabel>Current Level</CardLabel>
          <Text size="sm" c="dimmed">
            {currentLevel == null ? "Not configured" : "—"}
          </Text>
        </Stack>
      </Paper>
    );
  }

  const start = Math.max(0, currentLevel - window);
  const end = Math.min(levels.length - 1, currentLevel + window);

  return (
    <Paper p="md" radius={CARD_RADIUS} style={{ background: bg }}>
      <Stack align="center" gap={12}>
        <CardLabel>Current Level</CardLabel>
        <Group gap={0} wrap="nowrap" justify="center">
          {Array.from({ length: end - start + 1 }, (_, i) => {
            const idx = start + i;
            const isCurrent = idx === currentLevel;
            const dist = Math.abs(idx - currentLevel);
            const t = dist / window;
            const curve = t * t * t;
            const size = Math.max(8, Math.round(30 - curve * 22));
            const opacity = Math.max(0.12, 1 - t * t * 0.88);
            const fontSize = Math.max(6, size * 0.46);
            const gapRight =
              idx < end ? Math.max(0, Math.round(5 * (1 - t * t))) : 0;
            return (
              <Box
                key={idx}
                style={{
                  width: size,
                  height: size,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  marginRight: gapRight,
                  opacity,
                  background: isCurrent
                    ? `var(--mantine-color-${color}-6)`
                    : "transparent",
                  border: `2px solid ${isCurrent ? `var(--mantine-color-${color}-6)` : "var(--mantine-color-dark-4)"}`,
                }}
              >
                <Text
                  fw={isCurrent ? 700 : 400}
                  c={isCurrent ? "white" : "dimmed"}
                  lh={1}
                  style={{ fontSize }}
                >
                  {idx}
                </Text>
              </Box>
            );
          })}
        </Group>
      </Stack>
    </Paper>
  );
}

function MiniStatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color: string;
}) {
  const bg = useCardBg(color);
  return (
    <Paper
      p="sm"
      radius={CARD_RADIUS}
      style={{ background: bg, flex: 1, minWidth: 0 }}
    >
      <Stack gap={6} align="center">
        <Text
          c="dimmed"
          tt="uppercase"
          fw={600}
          ta="center"
          style={CARD_LABEL_STYLE}
        >
          {label}
        </Text>
        <Text
          className={outfit.className}
          style={{
            fontSize: "1.6rem",
            fontWeight: 700,
            lineHeight: 1,
            color: "white",
          }}
        >
          {String(value)}
        </Text>
      </Stack>
    </Paper>
  );
}

function GainLossWidget({
  gain,
  gainPct,
  annualROI,
  color,
  mask,
}: {
  gain: number | null;
  gainPct: number | null;
  annualROI: number | null;
  color: string;
  mask: (s: string) => string;
}) {
  const bg = useCardBg(color);
  const gainColor =
    gain == null ? "white" : gain >= 0 ? "white" : "var(--mantine-color-red-6)";

  return (
    <Paper p="md" radius={CARD_RADIUS} style={{ background: bg }}>
      <Stack gap="md" align="center">
        <CardLabel>Gain / Loss</CardLabel>
        <AnimatedNumber
          value={
            gain == null
              ? "—"
              : mask(`${gain >= 0 ? "" : "-"}$${fmt(Math.abs(gain), 0)}`)
          }
          className={outfit.className}
          style={{
            fontSize: "2rem",
            fontWeight: 700,
            lineHeight: 1,
            color: gainColor,
          }}
        />
        {(gainPct != null || annualROI != null) && (
          <Text size="sm" c="dimmed" ta="center">
            {gainPct != null && (
              <Text span fw={500}>
                {gainPct >= 0 ? "+" : ""}
                {gainPct.toFixed(1)}%
              </Text>
            )}
            {gainPct != null && annualROI != null && " · "}
            {annualROI != null && (
              <Text span fw={500}>
                {annualROI >= 0 ? "+" : ""}
                {annualROI.toFixed(1)}%/yr
              </Text>
            )}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

// ── column ─────────────────────────────────────────────────────────────────

function AccountColumn({
  data,
  mask,
  enabled,
  onToggle,
  gridColumn,
}: {
  data: AccountData;
  mask: (s: string) => string;
  enabled: boolean;
  onToggle: () => void;
  gridColumn: number;
}) {
  const {
    account,
    balance,
    levels,
    currentLevel,
    tqqqShares,
    openOptions,
    tradesToday,
    pendingBuyCost,
    cspCollateral,
    gain,
    gainPct,
    annualROI,
  } = data;
  const color = account.color;

  return (
    <div
      style={{
        gridColumn,
        gridRow: "1 / 6",
        display: "grid",
        gridTemplateRows: "subgrid",
        width: COLUMN_WIDTH,
      }}
    >
      {/* Row 1: Header — always full opacity so toggle remains usable */}
      <Group gap={8} justify="center" wrap="nowrap">
        <Switch checked={enabled} onChange={onToggle} color={color} size="sm" />
        <Text
          fw={700}
          size="sm"
          style={{ whiteSpace: "nowrap", opacity: enabled ? 1 : 0.4 }}
        >
          {account.accountName}
        </Text>
      </Group>

      {/* Rows 2–5: Cards — grayed out when disabled */}
      <Box
        style={{
          gridRow: "span 4",
          display: "grid",
          gridTemplateRows: "subgrid",
          opacity: enabled ? 1 : 0.35,
          filter: enabled ? undefined : "grayscale(1)",
          transition: "opacity 0.2s, filter 0.2s",
          pointerEvents: enabled ? undefined : "none",
        }}
      >
        <AccountValueWidget
          balance={balance}
          pendingBuyCost={pendingBuyCost}
          cspCollateral={cspCollateral}
          color={color}
          mask={mask}
        />
        <Group gap="xs" wrap="nowrap" align="stretch">
          <MiniStatCard label="Today" value={tradesToday} color={color} />
          <MiniStatCard label="Options" value={openOptions} color={color} />
          <MiniStatCard
            label="Shares"
            value={tqqqShares.toLocaleString()}
            color={color}
          />
        </Group>
        <GainLossWidget
          gain={gain}
          gainPct={gainPct}
          annualROI={annualROI}
          color={color}
          mask={mask}
        />
        <LevelWidget
          levels={levels}
          currentLevel={currentLevel}
          color={color}
        />
      </Box>
    </div>
  );
}

function CombinedColumn({
  balances,
  tqqqShares,
  openOptions,
  tradesToday,
  pendingBuyCost,
  cspCollateral,
  gain,
  gainPct,
  annualROI,
  avgLevel,
  anyLevels,
  mask,
  gridColumn,
}: {
  accounts: AccountData[];
  balances: AccountBalance[];
  tqqqShares: number;
  openOptions: number;
  tradesToday: number;
  pendingBuyCost: number;
  cspCollateral: number;
  gain: number | null;
  gainPct: number | null;
  annualROI: number | null;
  avgLevel: number | null;
  anyLevels: Level[];
  mask: (s: string) => string;
  gridColumn: number;
}) {
  const combinedBalance: AccountBalance | null =
    balances.length > 0
      ? {
          accountNumber: "combined",
          totalValue: balances.reduce((s, b) => s + b.totalValue, 0),
          cash: balances.reduce((s, b) => s + b.cash, 0),
          tqqqValue: balances.reduce((s, b) => s + b.tqqqValue, 0),
          moneyMarketValue: balances.reduce(
            (s, b) => s + b.moneyMarketValue,
            0,
          ),
          optionsValue: balances.reduce((s, b) => s + b.optionsValue, 0),
          otherValue: balances.reduce((s, b) => s + b.otherValue, 0),
          availableFunds: balances.reduce((s, b) => s + b.availableFunds, 0),
          cashAvailableForTrading: balances.reduce(
            (s, b) => s + b.cashAvailableForTrading,
            0,
          ),
        }
      : null;

  return (
    <div
      style={{
        gridColumn,
        gridRow: "1 / 6",
        display: "grid",
        gridTemplateRows: "subgrid",
        width: COLUMN_WIDTH,
        boxShadow: "inset 2px 0 0 rgba(120,120,120,0.15)",
        paddingLeft: 16,
      }}
    >
      <Group gap={8} justify="center">
        <Text fw={700} size="sm" c="dimmed">
          Combined
        </Text>
      </Group>

      <AccountValueWidget
        balance={combinedBalance}
        pendingBuyCost={pendingBuyCost}
        cspCollateral={cspCollateral > 0 ? cspCollateral : null}
        color="gray"
        mask={mask}
      />

      <Group gap="xs" wrap="nowrap" align="stretch">
        <MiniStatCard label="Today" value={tradesToday} color="gray" />
        <MiniStatCard label="Options" value={openOptions} color="gray" />
        <MiniStatCard
          label="Shares"
          value={tqqqShares.toLocaleString()}
          color="gray"
        />
      </Group>

      <GainLossWidget
        gain={gain}
        gainPct={gainPct}
        annualROI={annualROI}
        color="gray"
        mask={mask}
      />
      <LevelWidget levels={anyLevels} currentLevel={avgLevel} color="gray" />
    </div>
  );
}

// ── page ───────────────────────────────────────────────────────────────────

function AccountsPageInner() {
  const {
    accounts,
    balances,
    allFilledOrders,
    allWorkingOrders,
    allOptionPositions,
    allTqqqShares,
    privacyMode,
    snapshotLoading,
  } = useApp();
  const mask = createMask(privacyMode);
  const today = toDateKey(new Date());
  const DISABLED_KEY = "tqqq-accounts-disabled";
  const [disabledAccounts, setDisabledAccounts] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(DISABLED_KEY);
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });
  const [now] = useState(() => Date.now());

  const toggleAccount = (accountNumber: string) =>
    setDisabledAccounts((prev) => {
      const next = new Set(prev);
      next.has(accountNumber)
        ? next.delete(accountNumber)
        : next.add(accountNumber);
      localStorage.setItem(DISABLED_KEY, JSON.stringify([...next]));
      return next;
    });

  const accountData = useMemo<AccountData[]>(
    () =>
      accounts.map((account) => {
        const balance =
          balances.find((b) => b.accountNumber === account.accountNumber) ??
          null;
        const { levels, currentLevel } = buildLevelsAndCurrentLevel(
          account,
          allFilledOrders,
        );

        // Owned level indices for pending cost calculation
        const resetDate = account.settings.levelResetDate ?? null;
        const orders = allFilledOrders.filter(
          (o) => o.accountNumber === account.accountNumber,
        );
        const relevant = resetDate
          ? orders.filter((o) => new Date(o.time) >= resetDate)
          : orders;
        const lastFillSide = new Map<number, "BUY" | "SELL">();
        for (const o of relevant) {
          const idx = matchLevel(levels, o.shares, o.fillPrice);
          if (idx === -1) continue;
          if (!lastFillSide.has(idx)) lastFillSide.set(idx, o.side);
        }
        const ownedIndices = new Set(
          [...lastFillSide.entries()]
            .filter(([, s]) => s === "BUY")
            .map(([i]) => i),
        );

        const tqqqShares = allTqqqShares[account.accountNumber] ?? 0;
        const positions = allOptionPositions.filter(
          (o) => o.accountNumber === account.accountNumber,
        );
        const openOptions = positions.length;
        const tradesToday = allFilledOrders.filter(
          (o) =>
            o.accountNumber === account.accountNumber &&
            toDateKey(new Date(o.time)) === today,
        ).length;
        const pendingBuyCost = buildPendingBuyCost(
          account,
          allWorkingOrders,
          levels,
          ownedIndices,
        );
        const cspCollateral = (() => {
          const puts = positions.filter(
            (p) => p.putCall === "PUT" && p.shortQty > 0,
          );
          return puts.length > 0
            ? puts.reduce((s, p) => s + p.strike * 100 * p.shortQty, 0)
            : null;
        })();

        const initialCash = account.settings.initialCash;
        const startingDate = account.settings.startingDate;
        const totalValue = balance?.totalValue ?? null;
        const gain =
          initialCash != null && totalValue != null
            ? totalValue - initialCash
            : null;
        const gainPct =
          gain != null && initialCash ? (gain / initialCash) * 100 : null;
        const daysIn = startingDate
          ? Math.max(1, (now - startingDate.getTime()) / 86400000)
          : null;
        const annualROI =
          gainPct != null && daysIn != null ? (gainPct / daysIn) * 365 : null;

        return {
          account,
          balance,
          levels,
          currentLevel,
          tqqqShares,
          openOptions,
          tradesToday,
          pendingBuyCost,
          cspCollateral,
          gain,
          gainPct,
          annualROI,
        };
      }),
    [
      accounts,
      balances,
      allFilledOrders,
      allWorkingOrders,
      allOptionPositions,
      allTqqqShares,
      today,
      now,
    ],
  );

  const combinedBalances = useMemo(
    () =>
      balances.filter(
        (b) =>
          accounts.some((a) => a.accountNumber === b.accountNumber) &&
          !disabledAccounts.has(b.accountNumber),
      ),
    [balances, accounts, disabledAccounts],
  );

  const combined = useMemo(() => {
    const enabled = accountData.filter(
      (d) => !disabledAccounts.has(d.account.accountNumber),
    );
    const allHaveGain =
      enabled.length > 0 && enabled.every((d) => d.gain != null);
    const totalGain = allHaveGain
      ? enabled.reduce((s, d) => s + (d.gain ?? 0), 0)
      : null;
    const totalInitialCash = enabled.reduce(
      (s, d) => s + (d.account.settings.initialCash ?? 0),
      0,
    );

    const configuredLevels = enabled.filter(
      (d) => d.currentLevel != null && d.currentLevel >= 0,
    );
    const avgLevel =
      configuredLevels.length > 0
        ? Math.round(
            configuredLevels.reduce((s, d) => s + (d.currentLevel ?? 0), 0) /
              configuredLevels.length,
          )
        : null;
    const anyLevels = enabled.find((d) => d.levels.length > 0)?.levels ?? [];

    const earliestDate = enabled.reduce<Date | null>((earliest, d) => {
      const sd = d.account.settings.startingDate;
      if (!sd) return earliest;
      return earliest == null || sd < earliest ? sd : earliest;
    }, null);
    const gainPct =
      totalGain != null && totalInitialCash > 0
        ? (totalGain / totalInitialCash) * 100
        : null;
    const daysIn = earliestDate
      ? Math.max(1, (now - earliestDate.getTime()) / 86400000)
      : null;
    const annualROI =
      gainPct != null && daysIn != null ? (gainPct / daysIn) * 365 : null;

    return {
      tqqqShares: enabled.reduce((s, d) => s + d.tqqqShares, 0),
      openOptions: enabled.reduce((s, d) => s + d.openOptions, 0),
      tradesToday: enabled.reduce((s, d) => s + d.tradesToday, 0),
      pendingBuyCost: enabled.reduce((s, d) => s + (d.pendingBuyCost ?? 0), 0),
      cspCollateral: enabled.reduce((s, d) => s + (d.cspCollateral ?? 0), 0),
      gain: totalGain,
      gainPct:
        totalGain != null && totalInitialCash > 0
          ? (totalGain / totalInitialCash) * 100
          : null,
      annualROI,
      avgLevel,
      anyLevels,
    };
  }, [accountData, disabledAccounts, now]);

  if (snapshotLoading) {
    return (
      <Stack gap="md">
        <Text fw={700} size="xl" ta="center">
          All Accounts
        </Text>
        <Group gap="md" align="flex-start" justify="center" wrap="nowrap">
          {[0, 1, 2].map((i) => (
            <Stack
              key={i}
              gap="md"
              style={{ width: COLUMN_WIDTH, flexShrink: 0 }}
            >
              <Skeleton height={20} width={120} mx="auto" radius="sm" />
              <Skeleton height={260} radius="xl" />
              <Skeleton height={100} radius="xl" />
              <Skeleton height={80} radius="xl" />
              <Skeleton height={120} radius="xl" />
            </Stack>
          ))}
        </Group>
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      <Text fw={700} size="xl" ta="center">
        All Accounts
      </Text>
      <ScrollArea type="auto" offsetScrollbars>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${accountData.length + 1}, ${COLUMN_WIDTH}px)`,
            gridTemplateRows: "auto auto auto auto auto",
            columnGap: 16,
            rowGap: 16,
            width: "fit-content",
            margin: "0 auto",
            paddingBottom: 8,
          }}
        >
          {accountData.map((data, i) => (
            <AccountColumn
              key={data.account.accountNumber}
              data={data}
              mask={mask}
              enabled={!disabledAccounts.has(data.account.accountNumber)}
              onToggle={() => toggleAccount(data.account.accountNumber)}
              gridColumn={i + 1}
            />
          ))}
          <CombinedColumn
            accounts={accountData}
            balances={combinedBalances}
            tqqqShares={combined.tqqqShares}
            openOptions={combined.openOptions}
            tradesToday={combined.tradesToday}
            pendingBuyCost={combined.pendingBuyCost}
            cspCollateral={combined.cspCollateral}
            gain={combined.gain}
            gainPct={combined.gainPct}
            annualROI={combined.annualROI}
            avgLevel={combined.avgLevel}
            anyLevels={combined.anyLevels}
            mask={mask}
            gridColumn={accountData.length + 1}
          />
        </div>
      </ScrollArea>
    </Stack>
  );
}

export default function AccountsPage() {
  return (
    <Suspense>
      <AccountsPageInner />
    </Suspense>
  );
}
