"use client";

import { Fragment, useRef, useEffect } from "react";
import { Table, Text, Center, ThemeIcon, Stack, Tooltip } from "@mantine/core";
import { IconCheck, IconPlayerPlayFilled } from "@tabler/icons-react";
import { useMediaQuery } from "@mantine/hooks";
import { useApp } from "@/lib/context/AppContext";
import { useLevels } from "@/lib/hooks/useLevels";

const fmt = (n: number, decimals = 2) =>
  n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });


function ProgressRow({ progress, color, paddingTop, paddingBottom, cols }: {
  progress: number;
  color: string;
  paddingTop: number;
  paddingBottom: number;
  cols: number;
}) {
  return (
    <Table.Tr style={{ background: "transparent" }}>
      <Table.Td colSpan={cols} style={{ padding: 0, paddingTop, paddingBottom, border: "none" }}>
        <div style={{ height: 5, background: "var(--mantine-color-dark-5)", borderRadius: 2 }}>
          <div style={{
            height: "100%",
            width: `${progress}%`,
            background: `color-mix(in srgb, var(--mantine-color-${color}-7) ${progress}%, var(--mantine-color-gray-7))`,
            borderRadius: 2,
          }} />
        </div>
      </Table.Td>
    </Table.Tr>
  );
}

export default function LevelsPage() {
  const isMobile = useMediaQuery("(max-width: 768px)");
  const { activeAccount, privacyMode, quote } = useApp();
  const summary = useLevels();
  const accountColor = activeAccount?.color ?? "blue";
  const currentRowRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    currentRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [summary?.currentLevel, activeAccount?.accountNumber]);

  if (!summary) {
    return (
      <Center h={200}>
        <Text c="dimmed" size="sm">Configure account settings to see levels.</Text>
      </Center>
    );
  }

  const { levels, currentLevel, ownedLevels } = summary;

  const totalShares = ownedLevels.reduce((sum, l) => sum + l.shares, 0);
  const totalCost = ownedLevels.reduce((sum, l) => sum + l.cost, 0);
  const totalGainLoss = ownedLevels.reduce((sum, l) => sum + (quote.price - l.buyPrice) * l.shares, 0);
  const totalGainLossColor = totalGainLoss >= 0 ? "teal" : "red";

  const mask = (val: string) => (privacyMode ? "••••" : val);

  return (
    <Stack gap="md">
    <Text fw={700} size="xl">Levels</Text>
    <Table>
        <Table.Thead style={{ position: "sticky", top: isMobile ? 88 : 56, zIndex: 1, background: "var(--mantine-color-dark-7)" }}>
          <Table.Tr style={{ verticalAlign: "top" }}>
            <Table.Th w={40} />
            <Table.Th>
              Level
              <Text size="xs" c="dimmed">{currentLevel >= 0 ? currentLevel : "—"}</Text>
            </Table.Th>
            <Table.Th>Buy Price</Table.Th>
            <Table.Th>Sell Price</Table.Th>
            <Table.Th>
              Shares
              <Text size="xs" c="dimmed">{ownedLevels.length > 0 ? mask(fmt(totalShares, 0)) : "—"}</Text>
            </Table.Th>
            {!isMobile && <Table.Th>
              Cost
              <Text size="xs" c="dimmed">{ownedLevels.length > 0 ? mask(`$${fmt(totalCost)}`) : "—"}</Text>
            </Table.Th>}
            {!isMobile && <Table.Th>
              Gain / Loss
              <Text size="xs" c={ownedLevels.length > 0 && !quote.loading ? totalGainLossColor : "dimmed"}>
                {ownedLevels.length > 0 && !quote.loading ? mask(`${totalGainLoss >= 0 ? "+" : ""}$${fmt(totalGainLoss)}`) : "—"}
              </Text>
            </Table.Th>}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>

          {levels.map(({ n, buyPrice, sellPrice, shares, cost }) => {
            const owned = currentLevel >= 0 && n <= currentLevel;
            const inRange = !quote.loading && quote.price >= buyPrice && quote.price <= sellPrice;
            const progress = inRange
              ? ((quote.price - buyPrice) / (sellPrice - buyPrice)) * 100
              : 0;
            const gainLoss = owned ? (quote.price - buyPrice) * shares : null;
            const gainLossColor = gainLoss == null ? undefined : gainLoss >= 0 ? "teal" : "red";

            return (
              <Fragment key={n}>
                {inRange && <ProgressRow progress={progress} color={accountColor} paddingTop={6} paddingBottom={0} cols={isMobile ? 5 : 7} />}
                <Table.Tr ref={inRange ? currentRowRef : undefined} style={inRange ? { background: `color-mix(in srgb, var(--mantine-color-${accountColor}-7) 8%, transparent)` } : undefined}>
                  <Table.Td style={{ position: "relative" }}>
                    {inRange && (
                      <Tooltip label="Current price level" withArrow>
                        <IconPlayerPlayFilled
                          size={10}
                          color={`var(--mantine-color-${accountColor}-5)`}
                          style={{ position: "absolute", left: -4, top: "50%", transform: "translateY(-50%)", cursor: "default" }}
                        />
                      </Tooltip>
                    )}
                    {owned && (
                      <ThemeIcon variant="subtle" color="teal" size="sm">
                        <IconCheck size={12} />
                      </ThemeIcon>
                    )}
                  </Table.Td>
                  <Table.Td>{n}</Table.Td>
                  <Table.Td>{mask(`$${fmt(buyPrice)}`)}</Table.Td>
                  <Table.Td>{mask(`$${fmt(sellPrice)}`)}</Table.Td>
                  <Table.Td>{mask(fmt(shares, 0))}</Table.Td>
                  {!isMobile && <Table.Td>{mask(`$${fmt(cost)}`)}</Table.Td>}
                  {!isMobile && <Table.Td>
                    {gainLoss != null && (
                      <Text size="sm" c={gainLossColor}>
                        {mask(`${gainLoss >= 0 ? "+" : ""}$${fmt(gainLoss)}`)}
                      </Text>
                    )}
                  </Table.Td>}
                </Table.Tr>
                {inRange && <ProgressRow progress={progress} color={accountColor} paddingTop={0} paddingBottom={6} cols={isMobile ? 5 : 7} />}
              </Fragment>
            );
          })}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}
