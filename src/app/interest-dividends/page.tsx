"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Table, Text, Group, Stack, Skeleton, Paper, Badge, ScrollArea, SimpleGrid,
} from "@mantine/core";
import { useApp } from "@/lib/context/AppContext";
import type { Transaction } from "@/app/api/schwab/transactions/route";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

export default function InterestDividendsPage() {
  const { activeAccount, privacyMode, refreshTick } = useApp();
  const color = activeAccount?.color ?? "blue";
  const mask = (v: string) => (privacyMode ? "••••" : v);

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/schwab/transactions")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && Array.isArray(data)) setTransactions(data);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshTick]);

  const accountTransactions = useMemo(() => {
    if (!activeAccount) return transactions;
    return transactions.filter((t) => t.accountNumber === activeAccount.accountNumber);
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

  if (loading) {
    return (
      <Stack>
        <Skeleton height={80} radius="md" />
        <Skeleton height={300} radius="md" />
      </Stack>
    );
  }

  return (
    <Stack>
      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
        <Paper withBorder p="md" radius="md">
          <Text size="xs" c="dimmed" mb={4}>Total</Text>
          <Text fw={700} size="xl" c={total >= 0 ? color : "red"}>
            {mask(`$${fmt(total)}`)}
          </Text>
        </Paper>
        <Paper withBorder p="md" radius="md">
          <Text size="xs" c="dimmed" mb={4}>Dividends</Text>
          <Text fw={700} size="xl" c={totalDividends >= 0 ? color : "red"}>
            {mask(`$${fmt(totalDividends)}`)}
          </Text>
        </Paper>
        <Paper withBorder p="md" radius="md">
          <Text size="xs" c="dimmed" mb={4}>Interest</Text>
          <Text fw={700} size="xl" c={totalInterest >= 0 ? color : "red"}>
            {mask(`$${fmt(totalInterest)}`)}
          </Text>
        </Paper>
      </SimpleGrid>

      <Paper withBorder radius="md">
        <ScrollArea>
          {accountTransactions.length === 0 ? (
            <Text size="sm" c="dimmed" p="md">No interest or dividend transactions found.</Text>
          ) : (
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Date</Table.Th>
                  <Table.Th>Description</Table.Th>
                  <Table.Th>Symbol</Table.Th>
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
                    <Table.Td>
                      <Text size="sm">{t.description}</Text>
                    </Table.Td>
                    <Table.Td>
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
      </Paper>
    </Stack>
  );
}
