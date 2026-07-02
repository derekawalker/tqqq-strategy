"use client";

import { useEffect, useState, useMemo } from "react";
import { Stack, Text, Paper, Table, Alert, Center, Loader, Tooltip } from "@mantine/core";
import { IconInfoCircle, IconAlertTriangle } from "@tabler/icons-react";
import { useApp } from "@/lib/context/AppContext";
import { useLevels } from "@/lib/hooks/useLevels";
import { CARD_RADIUS, CARD_LABEL_STYLE } from "@/lib/cardStyles";
import { runCrashStress, DEFAULT_CRASH_SCENARIOS, type CrashStressRow } from "@/lib/crashStress";

function daysUntil(expiry: string): number {
  const ms = new Date(expiry + "T23:59:59").getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

const fmtMoney = (x: number) =>
  x.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

interface MarketData {
  qqqPrice: number | null;
  tqqqPrice: number | null;
  vxnPct: number | null;
  asOf: string | null;
  error?: string;
}

/**
 * Whole-book crash stress test: reprices today's actual TQQQ position, short
 * option book, and QQQ put hedge under instant shocks. Complements the
 * historical Hedge backtest tab by answering "if this happens tomorrow,
 * where does *today's book* land?" (ROADMAP.md item 3).
 */
export default function CrashStressPanel() {
  const { activeAccount, balances, optionPositions, tqqqShares } = useApp();
  const levelsSummary = useLevels();

  const [market, setMarket] = useState<MarketData | null>(null);
  const [marketLoading, setMarketLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/put-hedge")
      .then((r) => r.json())
      .then((d: MarketData) => { if (!cancelled && !d.error) setMarket(d); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setMarketLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const balance = balances.find((b) => b.accountNumber === activeAccount?.accountNumber) ?? null;

  const hedgePuts = useMemo(
    () => optionPositions.filter((p) => p.underlyingSymbol === "QQQ" && p.putCall === "PUT" && p.longQty > 0),
    [optionPositions],
  );
  const shortOptions = useMemo(
    () => optionPositions.filter((p) => p.underlyingSymbol === "TQQQ" && p.shortQty > 0),
    [optionPositions],
  );

  const rows: CrashStressRow[] | null = useMemo(() => {
    if (!market?.qqqPrice || !market?.tqqqPrice || !balance || !levelsSummary) return null;
    const ownedLevelIndices = new Set(levelsSummary.ownedLevels.map((l) => l.n));
    return runCrashStress({
      qqqSpot: market.qqqPrice,
      tqqqSpot: market.tqqqPrice,
      dteFor: (p) => daysUntil(p.expiry),
      tqqqShares,
      hedgePuts,
      shortOptions,
      levels: levelsSummary.levels,
      ownedLevelIndices,
      cashAvailable: balance.cashAvailableForTrading,
      scenarios: DEFAULT_CRASH_SCENARIOS,
    });
  }, [market, balance, levelsSummary, tqqqShares, hedgePuts, shortOptions]);

  if (marketLoading) {
    return (
      <Center h={200}>
        <Loader />
      </Center>
    );
  }

  if (!rows) {
    return (
      <Alert color="yellow" icon={<IconAlertTriangle size={16} />}>
        Not enough data yet (need live QQQ/TQQQ prices, balances, and configured ladder levels).
      </Alert>
    );
  }

  const worst = rows.reduce((w, r) => (r.netDrawdown > w.netDrawdown ? r : w));

  return (
    <Stack gap="md">
      <Text size="xs" c="dimmed">
        Instant-shock repricing of today&apos;s actual TQQQ position, short option book, and QQQ
        put hedge — spot down and IV up together, since a real crash moves both. TQQQ&apos;s
        modeled return accounts for leveraged-ETF volatility decay, not naive 3x.
      </Text>

      <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
        <Text size="sm" fw={600}>
          Worst case: {worst.scenario.label} → net drawdown {fmtMoney(worst.netDrawdown)}
        </Text>
        {worst.ladderCashNeeded > (balance?.cashAvailableForTrading ?? 0) && (
          <Text size="xs" c="dimmed">
            Cash needed at that scenario ({fmtMoney(worst.ladderCashNeeded)}) exceeds cash
            available ({fmtMoney(balance?.cashAvailableForTrading ?? 0)}).
          </Text>
        )}
      </Alert>

      <Paper radius={CARD_RADIUS} p="md" style={{ background: "var(--mantine-color-dark-7)" }}>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Scenario</Table.Th>
              <Table.Th ta="right">TQQQ</Table.Th>
              <Table.Th ta="right">
                <Tooltip label="Loss on the current TQQQ share position" withArrow>
                  <span style={{ cursor: "default", borderBottom: "1px dotted" }}>TQQQ Loss</span>
                </Tooltip>
              </Table.Th>
              <Table.Th ta="right">
                <Tooltip label="Gain on the open QQQ put hedge" withArrow>
                  <span style={{ cursor: "default", borderBottom: "1px dotted" }}>Hedge Payoff</span>
                </Tooltip>
              </Table.Th>
              <Table.Th ta="right">
                <Tooltip label="Change in cost-to-close the short covered-call/CSP book (positive = loss)" withArrow>
                  <span style={{ cursor: "default", borderBottom: "1px dotted" }}>Short Book</span>
                </Tooltip>
              </Table.Th>
              <Table.Th ta="right">
                <Tooltip label="Cash needed for unpurchased ladder levels + short-put assignment at the shocked price" withArrow>
                  <span style={{ cursor: "default", borderBottom: "1px dotted" }}>Cash Needed</span>
                </Tooltip>
              </Table.Th>
              <Table.Th ta="right">Net Drawdown</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row) => (
              <Table.Tr key={row.scenario.label}>
                <Table.Td>
                  <Text size="sm" fw={600}>{row.scenario.label}</Text>
                  <Text size="xs" c="dimmed">VXN {row.scenario.shockedVxnPct}</Text>
                </Table.Td>
                <Table.Td ta="right">
                  <Text size="sm">${row.tqqqShockedPrice.toFixed(2)}</Text>
                  <Text size="xs" c="red">{(row.tqqqReturnPct * 100).toFixed(0)}%</Text>
                </Table.Td>
                <Table.Td ta="right">
                  <Text size="sm" c="red">-{fmtMoney(row.tqqqPositionLoss)}</Text>
                </Table.Td>
                <Table.Td ta="right">
                  <Text size="sm" c="teal">+{fmtMoney(row.hedgePayoff)}</Text>
                </Table.Td>
                <Table.Td ta="right">
                  <Text size="sm" c={row.shortBookDamage >= 0 ? "red" : "teal"}>
                    {row.shortBookDamage >= 0 ? "-" : "+"}{fmtMoney(Math.abs(row.shortBookDamage))}
                  </Text>
                </Table.Td>
                <Table.Td ta="right">
                  <Text size="sm" c={row.ladderCashNeeded > (balance?.cashAvailableForTrading ?? 0) ? "red" : undefined}>
                    {fmtMoney(row.ladderCashNeeded)}
                  </Text>
                </Table.Td>
                <Table.Td ta="right">
                  <Text size="sm" fw={700} c="red">-{fmtMoney(row.netDrawdown)}</Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>

      <Text size="9px" c="dimmed" style={CARD_LABEL_STYLE}>
        <IconInfoCircle size={10} style={{ verticalAlign: "-1px", marginRight: 4 }} />
        Modeled, not a guarantee — Black-Scholes off shocked spot/IV, TQQQ leveraged-decay formula
        calibrated to this app&apos;s documented crash anchors. Actual fills, spreads, and path-
        dependent vol will differ.
      </Text>
    </Stack>
  );
}
