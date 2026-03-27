"use client";

import { useMemo } from "react";
import { useMediaQuery } from "@mantine/hooks";
import {
  Table, Text, Group, Stack, Skeleton, Paper, Badge, ScrollArea, SimpleGrid,
} from "@mantine/core";
import { Outfit } from "next/font/google";
import { useApp } from "@/lib/context/AppContext";
import { useCardBg } from "@/lib/hooks/useCardBg";
import { CARD_RADIUS } from "@/lib/cardStyles";

const outfit = Outfit({ subsets: ["latin"] });

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" });
};

export default function InterestDividendsPage() {
  const { activeAccount, privacyMode, transactions, snapshotLoading } = useApp();
  const color = activeAccount?.color ?? "blue";
  const bg = useCardBg(color);
  const isMobile = useMediaQuery("(max-width: 768px)");
  const mask = (v: string) => (privacyMode ? "••••" : v);

  const accountTransactions = useMemo(() => {
    const interestAndDividends = transactions.filter((t) => t.category === "interest" || t.category === "dividend");
    if (!activeAccount) return interestAndDividends;
    return interestAndDividends.filter((t) => t.accountNumber === activeAccount.accountNumber);
  }, [transactions, activeAccount]);

  const totalDividends = useMemo(
    () => accountTransactions.filter((t) => t.category === "dividend").reduce((s, t) => s + t.amount, 0),
    [accountTransactions]
  );
  const totalInterest = useMemo(
    () => accountTransactions.filter((t) => t.category === "interest").reduce((s, t) => s + t.amount, 0),
    [accountTransactions]
  );
  const total = totalDividends + totalInterest;

  if (snapshotLoading) {
    return (
      <Stack>
        <Skeleton height={80} radius="md" />
        <Skeleton height={300} radius="md" />
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      <Text fw={700} size="xl">Interest & Dividends</Text>
      <SimpleGrid cols={3} spacing="md">
        <Paper p="md" radius={CARD_RADIUS} style={{ background: bg }}>
          <Stack align="center" gap={4}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600} lts={0.5}>Dividends</Text>
            <Text fw={800} size="xl" c={totalDividends < 0 ? "red" : "white"} className={outfit.className}>
              {mask(`$${fmt(totalDividends)}`)}
            </Text>
          </Stack>
        </Paper>
        <Paper p="md" radius={CARD_RADIUS} style={{ background: bg }}>
          <Stack align="center" gap={4}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600} lts={0.5}>Interest</Text>
            <Text fw={800} size="xl" c={totalInterest < 0 ? "red" : "white"} className={outfit.className}>
              {mask(`$${fmt(totalInterest)}`)}
            </Text>
          </Stack>
        </Paper>
        <Paper p="md" radius={CARD_RADIUS} style={{ background: bg }}>
          <Stack align="center" gap={4}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600} lts={0.5}>Total</Text>
            <Text fw={800} size="xl" c={total < 0 ? "red" : "white"} className={outfit.className}>
              {mask(`$${fmt(total)}`)}
            </Text>
          </Stack>
        </Paper>
      </SimpleGrid>

      <ScrollArea>
          {accountTransactions.length === 0 ? (
            <Text size="sm" c="dimmed" p="md">No interest or dividend transactions found.</Text>
          ) : (
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Date</Table.Th>
                  <Table.Th>Description</Table.Th>
                  <Table.Th className="hide-mobile">Symbol</Table.Th>
                  <Table.Th>Type</Table.Th>
                  <Table.Th ta="right">Amount</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {accountTransactions.map((t) => (
                  <Table.Tr key={t.activityId}>
                    <Table.Td>
                      <Text size="sm" style={{ whiteSpace: "nowrap" }}>{fmtDate(t.time)}</Text>
                    </Table.Td>
                    <Table.Td style={{ maxWidth: isMobile ? 120 : undefined }}>
                      <Text size="sm" truncate="end">{t.description}</Text>
                    </Table.Td>
                    <Table.Td className="hide-mobile">
                      <Text size="sm" c="dimmed">{t.symbol ?? "—"}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        size="sm"
                        color={t.category === "dividend" ? color : "teal"}
                        variant="light"
                      >
                        {t.category}
                      </Badge>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="sm" c={t.amount >= 0 ? color : "red"}>
                        {mask(`${t.amount >= 0 ? "+" : ""}$${fmt(Math.abs(t.amount))}`)}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </ScrollArea>
    </Stack>
  );
}
