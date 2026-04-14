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

import { fmt, fmtDateShort as fmtDate, createMask } from "@/lib/format";
import { useAccountColor } from "@/lib/hooks/useAccountColor";

export default function InterestDividendsPage() {
  const { activeAccount, privacyMode, transactions, snapshotLoading } = useApp();
  const color = useAccountColor();
  const bg = useCardBg(color);
  const isMobile = useMediaQuery("(max-width: 768px)");
  const mask = createMask(privacyMode);

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
      <Stack gap="md">
        <Skeleton height={28} width={200} radius="sm" />
        <SimpleGrid cols={3} spacing="md">
          {["Dividends", "Interest", "Total"].map((label) => (
            <Paper key={label} p="md" radius={CARD_RADIUS} style={{ background: bg }}>
              <Stack align="center" gap={6}>
                <Skeleton height={11} width={label.length * 7} radius="sm" />
                <Skeleton height={22} width={80} radius="sm" />
              </Stack>
            </Paper>
          ))}
        </SimpleGrid>
        <Table>
          <Table.Thead>
            <Table.Tr>
              {["Date", "Description", "Type", "Amount"].map((col) => (
                <Table.Th key={col}><Skeleton height={11} width={col.length * 6.5} radius="sm" /></Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {Array.from({ length: 10 }).map((_, i) => (
              <Table.Tr key={i} style={{ opacity: i > 7 ? 0.4 : 1 }}>
                <Table.Td><Skeleton height={13} width={52} radius="sm" /></Table.Td>
                <Table.Td><Skeleton height={13} width={100 + (i % 3) * 25} radius="sm" /></Table.Td>

                <Table.Td><Skeleton height={18} width={58} radius="xl" /></Table.Td>
                <Table.Td><Skeleton height={13} width={55} radius="sm" style={{ marginLeft: "auto" }} /></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
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
