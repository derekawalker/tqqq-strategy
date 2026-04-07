"use client";

import { useMemo, useState } from "react";
import { Table, ScrollArea, Text, Center, Skeleton, Stack, Badge, NumberInput, Group, Tooltip, ThemeIcon, Modal, Code, Button, CopyButton } from "@mantine/core";
import { IconAlertTriangle, IconCheck, IconCopy, IconPlayerPlayFilled } from "@tabler/icons-react";
import { useApp } from "@/lib/context/AppContext";
import { useLevels } from "@/lib/hooks/useLevels";

const fmt = (n: number, decimals = 2) =>
  n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

interface LevelRow {
  levelIndex: number;
  shares: number;
  buyPrice: number | null;
  sellPrice: number | null;
  buys: number;
  sells: number;
}

function buildTosText(side: "BUY" | "SELL", shares: number, buyPrice: number, sellPrice: number, count: number): string {
  const lines: string[] = [];
  const pair = side === "BUY"
    ? [
        `BUY +${shares} TQQQ @${buyPrice.toFixed(2)} LMT GTC+EXTENDED OVERNIGHT`,
        `SELL -${shares} TQQQ @${sellPrice.toFixed(2)} LMT GTC+EXTENDED OVERNIGHT TRG BY`,
      ]
    : [
        `SELL -${shares} TQQQ @${sellPrice.toFixed(2)} LMT GTC+EXTENDED OVERNIGHT`,
        `BUY +${shares} TQQQ @${buyPrice.toFixed(2)} LMT GTC+EXTENDED OVERNIGHT TRG BY`,
      ];

  for (let i = 0; i < count; i++) {
    if (i === 0) {
      lines.push(pair[0]);
      lines.push(pair[1]);
    } else {
      lines.push(pair[0] + " TRG BY");
      lines.push(pair[1]);
    }
  }
  return lines.join("\n");
}

export default function WorkingOrdersPage() {
  const { workingOrders, snapshotLoading, privacyMode, activeAccount, updateAccountSettings } = useApp();
  const levelsSummary = useLevels();
  const [tosModal, setTosModal] = useState<{ text: string } | null>(null);

  const warnBelow = activeAccount?.settings.orderWarnBelow ?? 3;
  const buffer = activeAccount?.settings.orderBuffer ?? 5;
  const threshold = warnBelow ?? 0;
  const bufferSize = buffer ?? 0;

  const setWarnBelow = (v: number | string) =>
    updateAccountSettings(activeAccount!.accountNumber, { orderWarnBelow: typeof v === "number" ? v : null });
  const setBuffer = (v: number | string) =>
    updateAccountSettings(activeAccount!.accountNumber, { orderBuffer: typeof v === "number" ? v : null });

  const rows = useMemo<LevelRow[]>(() => {
    const counts = new Map<number, { buys: number; sells: number }>();
    for (const o of workingOrders) {
      const c = counts.get(o.shares) ?? { buys: 0, sells: 0 };
      if (o.side === "BUY") c.buys++; else c.sells++;
      counts.set(o.shares, c);
    }

    if (!levelsSummary) {
      // No settings — show orders without level matching
      const rows: LevelRow[] = Array.from(counts.entries()).map(([shares, c]) => ({
        levelIndex: -1, shares, buyPrice: null, sellPrice: null, ...c,
      }));
      rows.sort((a, b) => a.shares - b.shares);
      return rows;
    }

    let maxOrderLevel = -1;
    for (const [shares] of counts) {
      const idx = levelsSummary.levels.findIndex((l) => l.shares === shares);
      if (idx > maxOrderLevel) maxOrderLevel = idx;
    }

    const maxLevel = Math.max(
      levelsSummary.currentLevel + bufferSize,
      maxOrderLevel,
      levelsSummary.currentLevel,
    );
    const visibleLevels = levelsSummary.levels.slice(0, maxLevel + 1);

    const rows: LevelRow[] = visibleLevels.map((level, i) => {
      const c = counts.get(level.shares) ?? { buys: 0, sells: 0 };
      return {
        levelIndex: i,
        shares: level.shares,
        buyPrice: level.buyPrice,
        sellPrice: level.sellPrice,
        buys: c.buys,
        sells: c.sells,
      };
    });

    for (const [shares, c] of counts) {
      const matched = levelsSummary.levels.some((l) => l.shares === shares);
      if (!matched) {
        rows.push({ levelIndex: -1, shares, buyPrice: null, sellPrice: null, ...c });
      }
    }

    rows.sort((a, b) => a.shares - b.shares);
    return rows;
  }, [workingOrders, levelsSummary, bufferSize]);

  const mask = (val: string) => (privacyMode ? "••••" : val);

  const duplicateShares = useMemo(() => {
    const workingOnly = workingOrders.filter((o) => o.status === "WORKING");
    const counts = new Map<string, number>();
    for (const o of workingOnly) {
      const key = `${o.side}-${o.shares}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const dupes = new Set<number>();
    for (const [key, n] of counts) {
      if (n > 1) dupes.add(Number(key.split("-")[1]));
    }
    return dupes;
  }, [workingOrders]);


  if (snapshotLoading) {
    const colWidths = [40, 55, 30, 30, 70, 70, 60];
    return (
      <Stack gap="md">
        <Group justify="space-between" wrap="nowrap" align="flex-end">
          <Skeleton height={28} width={185} radius="sm" />
          <Group wrap="nowrap" gap="md">
            {[["Warn Qty", 90], ["Buffer levels", 90]].map(([label, w]) => (
              <Stack key={label} gap={4}>
                <Skeleton height={11} width={Number(w) - 10} radius="sm" />
                <Skeleton height={30} width={Number(w)} radius="sm" />
              </Stack>
            ))}
          </Group>
        </Group>

        <ScrollArea>
          <Table>
            <Table.Thead>
              <Table.Tr>
                {["Level", "Qty", "Buys", "Sells", "Buy Price", "Sell Price", "Cost"].map((col) => (
                  <Table.Th key={col} ta="center">
                    <Center><Skeleton height={11} width={col.length * 6.5} radius="sm" /></Center>
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {Array.from({ length: 10 }).map((_, i) => (
                <Table.Tr key={i} style={{ opacity: i > 6 ? 0.4 : 1 }}>
                  {colWidths.map((w, j) => (
                    <Table.Td key={j} ta="center">
                      <Center><Skeleton height={13} width={w + (i % 3 === 0 && j > 3 ? 10 : 0)} radius="sm" /></Center>
                    </Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Stack>
    );
  }

  if (rows.length === 0) {
    return (
      <Center h={200}>
        <Text c="dimmed" size="sm">No working orders.</Text>
      </Center>
    );
  }

  return (
    <>
    <Modal
      opened={tosModal !== null}
      onClose={() => setTosModal(null)}
      title="ThinkorSwim Order Text"
      size="lg"
    >
      <Stack gap="md">
        <Code block style={{ whiteSpace: "pre", fontFamily: "monospace", fontSize: 13, lineHeight: 1.6 }}>
          {tosModal?.text}
        </Code>
        <CopyButton value={tosModal?.text ?? ""}>
          {({ copied, copy }) => (
            <Button
              leftSection={<IconCopy size={16} />}
              variant={copied ? "filled" : "light"}
              color={copied ? "teal" : "blue"}
              onClick={copy}
            >
              {copied ? "Copied!" : "Copy to clipboard"}
            </Button>
          )}
        </CopyButton>
      </Stack>
    </Modal>
    <Stack gap="md">
      <Group justify="space-between" wrap="nowrap" align="flex-end">
        <Text fw={700} size="xl">Working Orders</Text>
        <Group wrap="nowrap" align="flex-end" gap="md">
          <Group wrap="nowrap" align="flex-end" gap="xs">
            <NumberInput
              key={`warn-${activeAccount?.accountNumber}`}
              label="Warn Qty"
              value={warnBelow ?? ""}
              onChange={setWarnBelow}
              min={0}
              max={99}
              w={90}
              size="xs"
            />
            <NumberInput
              key={`buffer-${activeAccount?.accountNumber}`}
              label="Buffer levels"
              value={buffer ?? ""}
              onChange={setBuffer}
              min={0}
              max={50}
              w={90}
              size="xs"
            />
          </Group>
        </Group>
      </Group>

      <ScrollArea>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th ta="center">Level</Table.Th>
              <Table.Th ta="center">Qty</Table.Th>
              <Table.Th ta="center">Buys</Table.Th>
              <Table.Th ta="center">Sells</Table.Th>
              <Table.Th ta="center">Buy Price</Table.Th>
              <Table.Th ta="center">Sell Price</Table.Th>
              <Table.Th ta="center" className="hide-mobile">Cost</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row) => {
              const hasOrders = row.buys > 0 || row.sells > 0;
              const cost = row.buyPrice != null ? row.shares * row.buyPrice : null;
              const currentLevel = levelsSummary?.currentLevel ?? -1;
              const inBuffer = bufferSize > 0 && row.levelIndex >= 0
                && row.levelIndex !== currentLevel
                && Math.abs(row.levelIndex - currentLevel) <= bufferSize;
              const bufferMissing = inBuffer && (row.buys === 0 || row.sells === 0);
              const buyWarn = hasOrders && threshold > 0 && row.buys < threshold;
              const sellWarn = hasOrders && threshold > 0 && row.sells < threshold;
              const isCurrent = row.levelIndex === currentLevel && currentLevel >= 0;
              const isOwned = row.levelIndex >= 0 && currentLevel >= 0 && row.levelIndex <= currentLevel;
              const hasDuplicate = duplicateShares.has(row.shares);

              return (
                <Table.Tr
                key={row.shares}
                bg={hasDuplicate ? "rgba(250,82,82,0.1)" : isCurrent ? "rgba(255,255,255,0.12)" : bufferMissing ? "rgba(251,146,60,0.1)" : undefined}
                style={{ opacity: !hasOrders && !bufferMissing ? 0.35 : 1, ...(hasDuplicate ? { borderLeft: "5px solid rgba(250,82,82,0.8)" } : bufferMissing ? { borderLeft: "5px solid rgba(251,146,60,0.8)" } : {}) }}
              >
                  <Table.Td ta="center" style={{ position: "relative" }}>
                    {isCurrent && (
                      <Tooltip label="Current price level" withArrow>
                        <IconPlayerPlayFilled
                          size={10}
                          color={`var(--mantine-color-${activeAccount?.color ?? "blue"}-5)`}
                          style={{ position: "absolute", left: -4, top: "50%", transform: "translateY(-50%)", cursor: "default" }}
                        />
                      </Tooltip>
                    )}
                    <Group justify="center" gap={4} wrap="nowrap">
                      {isOwned && (
                        <ThemeIcon variant="subtle" color="teal" size="sm">
                          <IconCheck size={12} />
                        </ThemeIcon>
                      )}
                      {hasDuplicate && (
                        <Tooltip label="Duplicate WORKING orders detected on this level" withArrow>
                          <IconCopy size={14} color="rgba(250,82,82,0.9)" style={{ cursor: "default" }} />
                        </Tooltip>
                      )}
                      <Text size="sm" fw={500}>{row.levelIndex >= 0 ? row.levelIndex : "—"}</Text>
                    </Group>
                  </Table.Td>
                  <Table.Td ta="center"><Text size="sm">{fmt(row.shares, 0)}</Text></Table.Td>
                  <Table.Td ta="center">
                    <Group justify="center" gap={4} wrap="nowrap">
                      {inBuffer && row.buys === 0 && (
                        <Tooltip label="Buffer zone — buy order should be open on this level" withArrow>
                          <IconAlertTriangle size={14} color="var(--mantine-color-orange-5)" style={{ cursor: "default" }} />
                        </Tooltip>
                      )}
                      {buyWarn
                        ? <Badge variant="filled" size="md" fw={700} style={{ background: "rgba(251,146,60,0.9)", color: "#fff", cursor: "pointer" }}
                            onClick={() => row.buyPrice != null && row.sellPrice != null && setTosModal({ text: buildTosText("BUY", row.shares, row.buyPrice, row.sellPrice, threshold) })}
                          >{row.buys}</Badge>
                        : row.buys > 0
                          ? <Text size="sm" c="teal">{row.buys}</Text>
                          : <Text size="sm" c="dimmed">—</Text>}
                    </Group>
                  </Table.Td>
                  <Table.Td ta="center">
                    <Group justify="center" gap={4} wrap="nowrap">
                      {inBuffer && row.sells === 0 && (
                        <Tooltip label="Buffer zone — sell order should be open on this level" withArrow>
                          <IconAlertTriangle size={14} color="var(--mantine-color-orange-5)" style={{ cursor: "default" }} />
                        </Tooltip>
                      )}
                      {sellWarn
                        ? <Badge variant="filled" size="md" fw={700} style={{ background: "rgba(251,146,60,0.9)", color: "#fff", cursor: "pointer" }}
                            onClick={() => row.buyPrice != null && row.sellPrice != null && setTosModal({ text: buildTosText("SELL", row.shares, row.buyPrice, row.sellPrice, threshold) })}
                          >{row.sells}</Badge>
                        : row.sells > 0
                          ? <Text size="sm" c="red">{row.sells}</Text>
                          : <Text size="sm" c="dimmed">—</Text>}
                    </Group>
                  </Table.Td>
                  <Table.Td ta="center">
                    <Text size="sm" c="dimmed">{row.buyPrice != null ? mask(`$${fmt(row.buyPrice)}`) : "—"}</Text>
                  </Table.Td>
                  <Table.Td ta="center">
                    <Text size="sm" c="dimmed">{row.sellPrice != null ? mask(`$${fmt(row.sellPrice)}`) : "—"}</Text>
                  </Table.Td>
                  <Table.Td ta="center" className="hide-mobile">
                    <Text size="sm" c="dimmed">{cost != null ? mask(`$${fmt(cost)}`) : "—"}</Text>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Stack>
    </>
  );

}
