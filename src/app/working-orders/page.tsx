"use client";

import { Fragment, useMemo, useState } from "react";
import { useMediaQuery } from "@mantine/hooks";
import {
  Table,
  ScrollArea,
  Text,
  Center,
  Skeleton,
  Stack,
  Badge,
  NumberInput,
  Group,
  Tooltip,
  ThemeIcon,
  Modal,
  Code,
  Button,
  CopyButton,
  Alert,
  Progress,
} from "@mantine/core";
import {
  IconCheck,
  IconCopy,
  IconPlayerPlayFilled,
  IconClock,
  IconRadar,
} from "@tabler/icons-react";
import { OrderQueue, type QueueItem } from "@/components/OrderQueue";
import { useApp } from "@/lib/context/AppContext";
import { useLevels } from "@/lib/hooks/useLevels";
import { countOrdersByLevel, matchLevel } from "@/lib/levels";
import { useSentiment } from "@/lib/hooks/useSentiment";
import { fmt, createMask } from "@/lib/format";
import { useAccountColor } from "@/lib/hooks/useAccountColor";
import { regimeThrottle } from "@/lib/sentiment";


function ProgressRow({ progress, color, paddingTop, paddingBottom }: {
  progress: number; color: string; paddingTop: number; paddingBottom: number;
}) {
  return (
    <Table.Tr style={{ background: "transparent" }}>
      <Table.Td
        colSpan={7}
        style={{ paddingTop, paddingBottom, paddingInline: 0, border: "none", lineHeight: 0, fontSize: 0 }}
      >
        <Progress
          value={progress}
          size={2}
          radius={0}
          styles={{
            section: {
              background: `color-mix(in srgb, var(--mantine-color-${color}-7) ${progress}%, var(--mantine-color-gray-7))`,
            },
          }}
        />
      </Table.Td>
    </Table.Tr>
  );
}

interface LevelRow {
  levelIndex: number;
  shares: number;
  buyPrice: number | null;
  sellPrice: number | null;
  buys: number;
  sells: number;
}

function buildTosText(
  side: "BUY" | "SELL",
  shares: number,
  buyPrice: number,
  sellPrice: number,
  count: number,
  endWithPrimary = false,
): string {
  const lines: string[] = [];
  const pair =
    side === "BUY"
      ? [
          `BUY +${shares} TQQQ @${buyPrice.toFixed(2)} LMT GTC+EXTENDED OVERNIGHT`,
          `SELL -${shares} TQQQ @${sellPrice.toFixed(2)} LMT GTC+EXTENDED OVERNIGHT TRG BY`,
        ]
      : [
          `SELL -${shares} TQQQ @${sellPrice.toFixed(2)} LMT GTC+EXTENDED OVERNIGHT`,
          `BUY +${shares} TQQQ @${buyPrice.toFixed(2)} LMT GTC+EXTENDED OVERNIGHT TRG BY`,
        ];

  for (let i = 0; i < count; i++) {
    lines.push(i === 0 ? pair[0] : pair[0] + " TRG BY");
    if (!endWithPrimary || i < count - 1) {
      lines.push(pair[1]);
    }
  }
  return lines.join("\n");
}

interface PlaceOrderModal {
  side: "BUY" | "SELL";
  shares: number;
  price: number;
}

export default function WorkingOrdersPage() {
  const {
    workingOrders,
    snapshotLoading,
    privacyMode,
    activeAccount,
    updateAccountSettings,
    quote,
    tickRefresh,
  } = useApp();
  const levelsSummary = useLevels();
  const sentiment = useSentiment();
  const accountColor = useAccountColor();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [tosModal, setTosModal] = useState<{ text: string } | null>(null);
  const [placeOrderModal, setPlaceOrderModal] =
    useState<PlaceOrderModal | null>(null);
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderResult, setOrderResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const isTastytrade = activeAccount?.broker === "tastytrade";

  interface QueuedPlaceOrder {
    side: "BUY" | "SELL";
    shares: number;
    price: number;
  }
  interface QueuedCancelOrder {
    orderId: string;
    accountNumber: string;
    side: "BUY" | "SELL";
    shares: number;
    price: number;
  }

  const [queuedPlaceOrders, setQueuedPlaceOrders] = useState<QueuedPlaceOrder[]>([]);
  const [queuedCancelOrders, setQueuedCancelOrders] = useState<QueuedCancelOrder[]>([]);

  const isPlaceOrderQueued = (side: "BUY" | "SELL", shares: number, price: number) =>
    queuedPlaceOrders.some((o) => o.side === side && o.shares === shares && o.price === price);

  const isCancelOrderQueued = (orderId: string) =>
    queuedCancelOrders.some((o) => o.orderId === orderId);

  const [cancelConfirm, setCancelConfirm] = useState<{
    orderId: string;
    accountNumber: string;
    side: "BUY" | "SELL";
    shares: number;
    price: number;
  } | null>(null);
  const [queueErrors, setQueueErrors] = useState<string[]>([]);

  const confirmCancel = () => {
    if (!cancelConfirm) return;
    setQueuedCancelOrders((prev) => [...prev, cancelConfirm]);
    setCancelConfirm(null);
  };

  const openPlaceOrder = (
    side: "BUY" | "SELL",
    shares: number,
    price: number,
  ) => setPlaceOrderModal({ side, shares, price });

  const closePlaceOrder = () => {
    setPlaceOrderModal(null);
    setOrderResult(null);
  };

  const addToQueue = () => {
    if (!placeOrderModal) return;
    setQueuedPlaceOrders((prev) => [...prev, placeOrderModal]);
    closePlaceOrder();
  };

  const directQueueOrder = (side: "BUY" | "SELL", shares: number, price: number) => {
    setQueuedPlaceOrders((prev) => [...prev, { side, shares, price }]);
  };

  const directQueueCancel = (orderId: string, accountNumber: string, side: "BUY" | "SELL", shares: number, price: number) => {
    setQueuedCancelOrders((prev) => [...prev, { orderId, accountNumber, side, shares, price }]);
  };

  const submitQueue = async () => {
    if (!activeAccount) return;
    setOrderLoading(true);

    const errors: string[] = [];
    const cancelOks: boolean[] = [];
    const placeOks: boolean[] = [];

    // Submit all cancellations first
    for (const order of queuedCancelOrders) {
      let ok = false;
      try {
        const res = await fetch("/api/tastytrade/orders", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: order.orderId, accountNumber: order.accountNumber }),
        });
        if (res.ok) ok = true;
        else {
          const json = await res.json();
          errors.push(`Cancel ${order.side}: ${json?.error?.message ?? "failed"}`);
        }
      } catch {
        errors.push(`Cancel ${order.side}: Network error`);
      }
      cancelOks.push(ok);
    }

    // Then submit all new orders
    for (const order of queuedPlaceOrders) {
      let ok = false;
      try {
        const res = await fetch("/api/tastytrade/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountNumber: activeAccount.accountNumber,
            side: order.side,
            shares: order.shares,
            price: order.price,
          }),
        });
        const json = await res.json();
        if (res.ok) ok = true;
        else {
          const raw = json?.error?.errors?.[0]?.message ?? json?.error?.message ?? json?.error?.error ?? json?.error;
          errors.push(`${order.side} ${order.shares}: ${typeof raw === "string" ? raw : JSON.stringify(raw)}`);
        }
      } catch {
        errors.push(`${order.side} ${order.shares}: Network error`);
      }
      placeOks.push(ok);
    }

    if (cancelOks.some(Boolean) || placeOks.some(Boolean)) tickRefresh();
    // Keep any failures queued for retry; drop the ones that succeeded.
    setQueuedCancelOrders((prev) => prev.filter((_, i) => !cancelOks[i]));
    setQueuedPlaceOrders((prev) => prev.filter((_, i) => !placeOks[i]));
    setQueueErrors(errors);
    setOrderLoading(false);
  };

  const warnBelow = activeAccount?.settings.orderWarnBelow ?? 3;
  const buffer = activeAccount?.settings.orderBuffer ?? 5;
  // tastytrade enforces max 1 order per level — qty warning doesn't apply
  const threshold = isTastytrade ? 0 : (warnBelow ?? 0);
  const bufferSize = buffer ?? 0;

  const queueItems: QueueItem[] = [
    ...queuedCancelOrders.map((o) => ({
      key: `c-${o.orderId}`,
      type: "cancel" as const,
      side: o.side, shares: o.shares, price: o.price,
      onRemove: () => setQueuedCancelOrders((prev) => prev.filter((x) => x.orderId !== o.orderId)),
    })),
    ...queuedPlaceOrders.map((o, idx) => ({
      key: `p-${idx}-${o.side}-${o.price}-${o.shares}`,
      type: "place" as const,
      side: o.side, shares: o.shares, price: o.price,
      onRemove: () => setQueuedPlaceOrders((prev) => prev.filter((_, i) => i !== idx)),
    })),
  ];

  const setWarnBelow = (v: number | string) =>
    updateAccountSettings(activeAccount!.accountNumber, {
      orderWarnBelow: typeof v === "number" ? v : null,
    });
  const setBuffer = (v: number | string) =>
    updateAccountSettings(activeAccount!.accountNumber, {
      orderBuffer: typeof v === "number" ? v : null,
    });

  const rows = useMemo<LevelRow[]>(() => {
    if (!levelsSummary) {
      // No settings — show orders without level matching
      const counts = new Map<number, { buys: number; sells: number }>();
      for (const o of workingOrders) {
        const c = counts.get(o.shares) ?? { buys: 0, sells: 0 };
        if (o.side === "BUY") c.buys++;
        else c.sells++;
        counts.set(o.shares, c);
      }
      const rows: LevelRow[] = Array.from(counts.entries()).map(
        ([shares, c]) => ({
          levelIndex: -1,
          shares,
          buyPrice: null,
          sellPrice: null,
          ...c,
        }),
      );
      rows.sort((a, b) => a.shares - b.shares || b.levelIndex - a.levelIndex);
      return rows;
    }

    const { byLevel, unmatched } = countOrdersByLevel(
      levelsSummary.levels,
      workingOrders,
    );

    let maxOrderLevel = -1;
    for (const idx of byLevel.keys()) {
      if (idx > maxOrderLevel) maxOrderLevel = idx;
    }

    const maxLevel = Math.max(
      levelsSummary.currentLevel + bufferSize,
      maxOrderLevel,
      levelsSummary.currentLevel,
    );
    const visibleLevels = levelsSummary.levels.slice(0, maxLevel + 1);

    const rows: LevelRow[] = visibleLevels.map((level, i) => {
      const c = byLevel.get(i) ?? { buys: 0, sells: 0 };
      return {
        levelIndex: i,
        shares: level.shares,
        buyPrice: level.buyPrice,
        sellPrice: level.sellPrice,
        buys: c.buys,
        sells: c.sells,
      };
    });

    for (const [shares, c] of unmatched) {
      rows.push({
        levelIndex: -1,
        shares,
        buyPrice: null,
        sellPrice: null,
        ...c,
      });
    }

    rows.sort((a, b) => a.shares - b.shares || b.levelIndex - a.levelIndex);
    return rows;
  }, [workingOrders, levelsSummary, bufferSize]);

  const mask = createMask(privacyMode);

  // Duplicate = more than one WORKING order on the same side of the same level
  // (or same share count when no level matches). Keys: "L<index>" / "S<shares>".
  const duplicateKeys = useMemo(() => {
    const workingOnly = workingOrders.filter((o) => o.status === "WORKING");
    const counts = new Map<string, number>();
    for (const o of workingOnly) {
      const idx = levelsSummary
        ? matchLevel(levelsSummary.levels, o.shares, o.limitPrice)
        : -1;
      const rowKey = idx >= 0 ? `L${idx}` : `S${o.shares}`;
      counts.set(`${o.side}-${rowKey}`, (counts.get(`${o.side}-${rowKey}`) ?? 0) + 1);
    }
    const dupes = new Set<string>();
    for (const [key, n] of counts) {
      if (n > 1) dupes.add(key.slice(key.indexOf("-") + 1));
    }
    return dupes;
  }, [workingOrders, levelsSummary]);

  if (snapshotLoading) {
    const colWidths = [40, 55, 30, 30, 70, 70, 60];
    return (
      <Stack gap="md">
        <Group justify="space-between" wrap="nowrap" align="flex-end">
          <Skeleton height={28} width={185} radius="sm" />
          <Group wrap="nowrap" gap="md">
            {[
              ["Warn Qty", 90],
              ["Buffer levels", 90],
            ].map(([label, w]) => (
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
                {[
                  "Level",
                  "Qty",
                  "Buys",
                  "Sells",
                  "Buy Price",
                  "Sell Price",
                  "Cost",
                ].map((col) => (
                  <Table.Th key={col} ta="center">
                    <Center>
                      <Skeleton
                        height={11}
                        width={col.length * 6.5}
                        radius="sm"
                      />
                    </Center>
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {Array.from({ length: 10 }).map((_, i) => (
                <Table.Tr key={i} style={{ opacity: i > 6 ? 0.4 : 1 }}>
                  {colWidths.map((w, j) => (
                    <Table.Td key={j} ta="center">
                      <Center>
                        <Skeleton
                          height={13}
                          width={w + (i % 3 === 0 && j > 3 ? 10 : 0)}
                          radius="sm"
                        />
                      </Center>
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
        <Text c="dimmed" size="sm">
          No working orders.
        </Text>
      </Center>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight:
          "calc(100dvh - var(--app-shell-header-height) - var(--mantine-spacing-md) * 2)",
      }}
    >
      <Modal
        opened={tosModal !== null}
        onClose={() => setTosModal(null)}
        title="ThinkorSwim Order Text"
        size="lg"
      >
        <Stack gap="md">
          <Code
            block
            style={{
              whiteSpace: "pre",
              fontFamily: "monospace",
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
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

      <Modal
        opened={cancelConfirm !== null}
        onClose={() => setCancelConfirm(null)}
        title="Cancel Order"
        size="sm"
      >
        <Stack gap="md">
          {cancelConfirm && (
            <Text size="sm">
              Cancel{" "}
              <Text
                span
                fw={700}
                c={cancelConfirm.side === "BUY" ? "teal" : "red"}
              >
                {cancelConfirm.side}
              </Text>{" "}
              {fmt(cancelConfirm.shares, 0)} TQQQ @ ${fmt(cancelConfirm.price)}?
            </Text>
          )}
          {(queuedPlaceOrders.length > 0 || queuedCancelOrders.length > 0) && (
            <Alert color="blue" variant="light">
              Queue: {queuedCancelOrders.length} to cancel, {queuedPlaceOrders.length} to place
            </Alert>
          )}
          <Group justify="flex-end">
            <Button color="red" onClick={() => {
              confirmCancel();
              setCancelConfirm(null);
            }}>
              Add to Queue
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={placeOrderModal !== null}
        onClose={closePlaceOrder}
        title={<Text fw={700}>Queue Order</Text>}
      >
        <Stack gap="md">
          {placeOrderModal && (
            <Text size="sm">
              <Text
                span
                fw={700}
                c={placeOrderModal.side === "BUY" ? "teal" : "red"}
              >
                {placeOrderModal.side}
              </Text>{" "}
              {fmt(placeOrderModal.shares, 0)} TQQQ @ $
              {fmt(placeOrderModal.price)} GTC Ext Overnight limit
            </Text>
          )}
          {(queuedPlaceOrders.length > 0 || queuedCancelOrders.length > 0) && (
            <Alert color="blue" variant="light">
              Queue: {queuedCancelOrders.length} to cancel, {queuedPlaceOrders.length} to place
            </Alert>
          )}
          <Group justify="flex-end">
            <Button
              variant="subtle"
              color="gray"
              onClick={closePlaceOrder}
            >
              Cancel
            </Button>
            <Button
              color={placeOrderModal?.side === "BUY" ? "teal" : "red"}
              onClick={addToQueue}
            >
              Add to Queue
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Stack gap="md">
        <Group justify="space-between" wrap="nowrap" align="flex-end">
          <Group gap="xs" align="center">
            <Text fw={700} size="xl">
              Working Orders
            </Text>
          </Group>
          <Group wrap="nowrap" align="flex-end" gap="md">
            <Group wrap="nowrap" align="flex-end" gap="xs">
              {!isTastytrade && (
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
              )}
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

        {sentiment && sentiment.regime !== "Risk-On" && (
          <Alert
            color={sentiment.regime === "Risk-Off" ? "red" : "orange"}
            variant="light"
            icon={<IconRadar size={16} />}
          >
            <Text size="sm" fw={600}>
              Regime: {sentiment.regime}
              {sentiment.daysInRegime <= 1 ? " (just changed)" : ` — ${sentiment.daysInRegime}d`}
            </Text>
            <Text size="xs" c="dimmed">
              Ladder buys: {regimeThrottle(sentiment.regime).label}
            </Text>
          </Alert>
        )}


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
                <Table.Th ta="center" className="hide-mobile">
                  Cost
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(() => {
                const rowsWithOrders = rows.filter(
                  (r) => r.buys > 0 || r.sells > 0,
                );
                const activeIndices = rowsWithOrders
                  .map((r) => r.levelIndex)
                  .filter((i) => i >= 0);
                const maxOrderIdx =
                  activeIndices.length > 0 ? Math.max(...activeIndices) : -1;
                const minActiveIdx =
                  activeIndices.length > 0 ? Math.min(...activeIndices) : -1;
                const topPlusIdx =
                  levelsSummary && maxOrderIdx >= 0
                    ? maxOrderIdx + 1
                    : isTastytrade && levelsSummary
                      ? levelsSummary.currentLevel + bufferSize + 1
                      : -1;
                const bottomPlusIdx = minActiveIdx > 0 ? minActiveIdx - 1 : -1;
                const topPlusInRows = rows.some(
                  (r) => r.levelIndex === topPlusIdx,
                );
                const topLevel =
                  !topPlusInRows && topPlusIdx >= 0
                    ? (levelsSummary?.levels[topPlusIdx] ?? null)
                    : null;
                return (
                  <>
                    {topLevel &&
                      (() => {
                        const cost =
                          topLevel.buyPrice != null
                            ? topLevel.shares * topLevel.buyPrice
                            : null;
                        return (
                          <Table.Tr
                            key="next-level"
                            style={{
                              borderBottom: "2px solid rgba(255,255,255,0.08)",
                            }}
                          >
                            <Table.Td ta="center">
                              <Text size="sm" fw={500} c="dimmed">
                                {topPlusIdx}
                              </Text>
                            </Table.Td>
                            <Table.Td ta="center">
                              <Text size="sm" c="dimmed">
                                {fmt(topLevel.shares, 0)}
                              </Text>
                            </Table.Td>
                            <Table.Td ta="center">
                              <Badge
                                variant="filled"
                                size="md"
                                fw={700}
                                style={{
                                  background: "var(--mantine-color-teal-7)",
                                  color: "#fff",
                                  cursor:
                                    topLevel.buyPrice != null
                                      ? "pointer"
                                      : "default",
                                }}
                                onClick={() => {
                                  if (topLevel.buyPrice == null) return;
                                  isTastytrade
                                    ? directQueueOrder(
                                        "BUY",
                                        topLevel.shares,
                                        topLevel.buyPrice!,
                                      )
                                    : topLevel.sellPrice != null &&
                                      setTosModal({
                                        text: buildTosText(
                                          "BUY",
                                          topLevel.shares,
                                          topLevel.buyPrice!,
                                          topLevel.sellPrice!,
                                          4,
                                        ),
                                      });
                                }}
                              >
                                +
                              </Badge>
                            </Table.Td>
                            <Table.Td ta="center">
                              {!isTastytrade && (
                                <Badge
                                  variant="filled"
                                  size="md"
                                  fw={700}
                                  style={{
                                    background: "var(--mantine-color-red-7)",
                                    color: "#fff",
                                    cursor:
                                      topLevel.buyPrice != null &&
                                      topLevel.sellPrice != null
                                        ? "pointer"
                                        : "default",
                                  }}
                                  onClick={() =>
                                    topLevel.buyPrice != null &&
                                    topLevel.sellPrice != null &&
                                    setTosModal({
                                      text: buildTosText(
                                        "SELL",
                                        topLevel.shares,
                                        topLevel.buyPrice!,
                                        topLevel.sellPrice!,
                                        4,
                                      ),
                                    })
                                  }
                                >
                                  +
                                </Badge>
                              )}
                            </Table.Td>
                            <Table.Td ta="center">
                              <Text size="sm" c="dimmed">
                                {topLevel.buyPrice != null
                                  ? mask(`$${fmt(topLevel.buyPrice)}`)
                                  : "—"}
                              </Text>
                            </Table.Td>
                            <Table.Td ta="center">
                              <Text size="sm" c="dimmed">
                                {topLevel.sellPrice != null
                                  ? mask(`$${fmt(topLevel.sellPrice)}`)
                                  : "—"}
                              </Text>
                            </Table.Td>
                            <Table.Td ta="center" className="hide-mobile">
                              <Text size="sm" c="dimmed">
                                {cost != null ? mask(`$${fmt(cost)}`) : "—"}
                              </Text>
                            </Table.Td>
                          </Table.Tr>
                        );
                      })()}
                    {rows.map((row) => {
                      const hasOrders = row.buys > 0 || row.sells > 0;
                      const isBottomPlus = row.levelIndex === bottomPlusIdx;
                      const isTopPlus = row.levelIndex === topPlusIdx;
                      const cost =
                        row.buyPrice != null ? row.shares * row.buyPrice : null;
                      const currentLevel = levelsSummary?.currentLevel ?? -1;
                      const inBuffer =
                        bufferSize > 0 &&
                        row.levelIndex >= 0 &&
                        row.levelIndex !== currentLevel &&
                        Math.abs(row.levelIndex - currentLevel) <= bufferSize;
                      // tastytrade: max 1 order per level — warn only if the level has no orders at all
                      const bufferMissing =
                        inBuffer &&
                        (isTastytrade
                          ? row.buys === 0 && row.sells === 0
                          : row.buys === 0 || row.sells === 0);
                      const rowWarn =
                        hasOrders &&
                        threshold > 0 &&
                        (row.buys < threshold || row.sells < threshold);
                      const buyWarn = rowWarn;
                      const sellWarn = rowWarn;
                      // tastytrade: suppress a column when the other direction already has an order,
                      // and when both are empty only show the expected direction
                      // (higher levelIndex = lower price = expects BUY; lower = higher price = expects SELL)
                      const buyColVisible =
                        !isTastytrade ||
                        (row.sells === 0 &&
                          (currentLevel < 0 || row.levelIndex >= currentLevel));
                      const sellColVisible =
                        !isTastytrade ||
                        (row.buys === 0 &&
                          currentLevel >= 0 &&
                          row.levelIndex <= currentLevel);
                      const isCurrent =
                        row.levelIndex === currentLevel && currentLevel >= 0;
                      const priceInRange =
                        !quote.loading &&
                        row.buyPrice != null &&
                        row.sellPrice != null &&
                        quote.price >= row.buyPrice &&
                        quote.price <= row.sellPrice;
                      const progress = priceInRange && row.buyPrice != null && row.sellPrice != null
                        ? ((quote.price - row.buyPrice) / (row.sellPrice - row.buyPrice)) * 100
                        : 0;
                      const isOwned =
                        row.levelIndex >= 0 &&
                        currentLevel >= 0 &&
                        row.levelIndex <= currentLevel;
                      const hasDuplicate = duplicateKeys.has(
                        row.levelIndex >= 0 ? `L${row.levelIndex}` : `S${row.shares}`,
                      );

                      const progressColor = bufferMissing ? "orange" : accountColor;

                      return (
                        <Fragment key={`${row.shares}-${row.levelIndex}`}>
                        {priceInRange && <ProgressRow progress={progress} color={progressColor} paddingTop={6} paddingBottom={0} />}
                        <Table.Tr
                          style={{
                            opacity: 1,
                            background: hasDuplicate
                              ? "rgba(250,82,82,0.1)"
                              : bufferMissing
                                ? "rgba(251,146,60,0.1)"
                                : priceInRange
                                  ? `color-mix(in srgb, var(--mantine-color-${accountColor}-7) 8%, transparent)`
                                  : isCurrent
                                    ? "rgba(255,255,255,0.12)"
                                    : undefined,
                            ...(hasDuplicate
                              ? { borderLeft: "5px solid rgba(250,82,82,0.8)" }
                              : bufferMissing
                                ? { borderLeft: "5px solid rgba(251,146,60,0.8)" }
                                : {}),
                          }}
                        >
                          <Table.Td
                            ta="center"
                            style={{ position: "relative" }}
                          >
                            {priceInRange && (
                              <Tooltip
                                label={`Current price $${fmt(quote.price)} is between buy and sell`}
                                withArrow
                              >
                                <IconPlayerPlayFilled
                                  size={10}
                                  color={
                                    bufferMissing
                                      ? "var(--mantine-color-orange-5)"
                                      : `var(--mantine-color-${accountColor}-5)`
                                  }
                                  style={{
                                    position: "absolute",
                                    left: -4,
                                    top: "50%",
                                    transform: "translateY(-50%)",
                                    cursor: "default",
                                  }}
                                />
                              </Tooltip>
                            )}
                            <Group justify="center" gap={4} wrap="nowrap">
                              {isOwned && (
                                <ThemeIcon
                                  variant="subtle"
                                  color="teal"
                                  size="sm"
                                >
                                  <IconCheck size={12} />
                                </ThemeIcon>
                              )}
                              {hasDuplicate && (
                                <Tooltip
                                  label="Duplicate WORKING orders detected on this level"
                                  withArrow
                                >
                                  <IconCopy
                                    size={14}
                                    color="rgba(250,82,82,0.9)"
                                    style={{ cursor: "default" }}
                                  />
                                </Tooltip>
                              )}
                              <Text size="sm" fw={500}>
                                {row.levelIndex >= 0 ? row.levelIndex : "—"}
                              </Text>
                            </Group>
                          </Table.Td>
                          <Table.Td ta="center">
                            <Text size="sm">{fmt(row.shares, 0)}</Text>
                          </Table.Td>
                          <Table.Td ta="center">
                            <div
                              style={{
                                display: "flex",
                                flexDirection: isMobile ? "column" : "row",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: isMobile ? 2 : 4,
                              }}
                            >
                              {buyWarn ? (
                                <Badge
                                  variant="filled"
                                  size="md"
                                  fw={700}
                                  style={{
                                    background: "rgba(251,146,60,0.9)",
                                    color: "#fff",
                                    cursor: "pointer",
                                  }}
                                  onClick={() =>
                                    row.buyPrice != null &&
                                    row.sellPrice != null &&
                                    setTosModal({
                                      text: buildTosText(
                                        "SELL",
                                        row.shares,
                                        row.buyPrice,
                                        row.sellPrice,
                                        3,
                                      ),
                                    })
                                  }
                                >
                                  {row.buys}
                                </Badge>
                              ) : row.buys > 0 ? (
                                (() => {
                                  const order = isTastytrade
                                    ? workingOrders.find(
                                        (o) =>
                                          o.side === "BUY" &&
                                          o.shares === row.shares,
                                      )
                                    : null;
                                  const isQueued = order ? isCancelOrderQueued(String(order.orderId)) : false;
                                  return order ? (
                                    <Tooltip label={isQueued ? "Queued for cancellation" : "Click to queue cancellation"}>
                                      <Badge
                                        variant="outline"
                                        size="md"
                                        fw={700}
                                        color={isQueued ? "orange" : "teal"}
                                        style={{
                                          cursor: "pointer",
                                          ...(isMobile ? { paddingInline: 8 } : {}),
                                        }}
                                        leftSection={isQueued ? <IconClock size={12} /> : undefined}
                                        onClick={() =>
                                          !isQueued &&
                                          (isTastytrade
                                            ? directQueueCancel(String(order.orderId), order.accountNumber, order.side, order.shares, order.limitPrice)
                                            : setCancelConfirm({
                                                orderId: String(order.orderId),
                                                accountNumber: order.accountNumber,
                                                side: order.side,
                                                shares: order.shares,
                                                price: order.limitPrice,
                                              }))
                                        }
                                      >
                                        {row.buys}
                                      </Badge>
                                    </Tooltip>
                                  ) : (
                                    <Text size="sm" c="teal">{row.buys}</Text>
                                  );
                                })()
                              ) : buyColVisible ? (
                                (() => {
                                  const isQueued = row.buyPrice != null && isPlaceOrderQueued("BUY", row.shares, row.buyPrice);
                                  return (
                                    <Tooltip label={isQueued ? "Queued for placement" : "Click to queue"}>
                                      <Badge
                                        variant="filled"
                                        size="md"
                                        fw={700}
                                        style={{
                                          background: isQueued
                                            ? "rgba(251,146,60,0.9)"
                                            : bufferMissing
                                              ? "rgba(251,146,60,0.9)"
                                              : "var(--mantine-color-teal-7)",
                                          color: "#fff",
                                          cursor:
                                            row.buyPrice != null
                                              ? "pointer"
                                              : "default",
                                          ...(isMobile ? { paddingInline: 8 } : {}),
                                        }}
                                        leftSection={isQueued ? <IconClock size={12} /> : undefined}
                                        onClick={() => {
                                          if (row.buyPrice == null || isQueued) return;
                                          isTastytrade
                                            ? directQueueOrder(
                                                "BUY",
                                                row.shares,
                                                row.buyPrice,
                                              )
                                            : row.sellPrice != null &&
                                              setTosModal({
                                                text: buildTosText(
                                                  "BUY",
                                                  row.shares,
                                                  row.buyPrice,
                                                  row.sellPrice,
                                                  4,
                                                ),
                                              });
                                        }}
                                      >
                                        {isQueued ? "" : "+"}
                                      </Badge>
                                    </Tooltip>
                                  );
                                })()
                              ) : null}
                            </div>
                          </Table.Td>
                          <Table.Td ta="center">
                            <div
                              style={{
                                display: "flex",
                                flexDirection: isMobile ? "column" : "row",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: isMobile ? 2 : 4,
                              }}
                            >
                              {sellWarn ? (
                                <Badge
                                  variant="filled"
                                  size="md"
                                  fw={700}
                                  style={{
                                    background: "rgba(251,146,60,0.9)",
                                    color: "#fff",
                                    cursor: "pointer",
                                  }}
                                  onClick={() =>
                                    row.buyPrice != null &&
                                    row.sellPrice != null &&
                                    setTosModal({
                                      text: buildTosText(
                                        "BUY",
                                        row.shares,
                                        row.buyPrice,
                                        row.sellPrice,
                                        3,
                                      ),
                                    })
                                  }
                                >
                                  {row.sells}
                                </Badge>
                              ) : row.sells > 0 ? (
                                (() => {
                                  const order = isTastytrade
                                    ? workingOrders.find(
                                        (o) =>
                                          o.side === "SELL" &&
                                          o.shares === row.shares,
                                      )
                                    : null;
                                  const isQueued = order ? isCancelOrderQueued(String(order.orderId)) : false;
                                  return order ? (
                                    <Tooltip label={isQueued ? "Queued for cancellation" : "Click to queue cancellation"}>
                                      <Badge
                                        variant="outline"
                                        size="md"
                                        fw={700}
                                        color={isQueued ? "orange" : "red"}
                                        style={{
                                          cursor: "pointer",
                                          ...(isMobile ? { paddingInline: 8 } : {}),
                                        }}
                                        leftSection={isQueued ? <IconClock size={12} /> : undefined}
                                        onClick={() =>
                                          !isQueued &&
                                          (isTastytrade
                                            ? directQueueCancel(String(order.orderId), order.accountNumber, order.side, order.shares, order.limitPrice)
                                            : setCancelConfirm({
                                                orderId: String(order.orderId),
                                                accountNumber: order.accountNumber,
                                                side: order.side,
                                                shares: order.shares,
                                                price: order.limitPrice,
                                              }))
                                        }
                                      >
                                        {row.sells}
                                      </Badge>
                                    </Tooltip>
                                  ) : (
                                    <Text size="sm" c="red">{row.sells}</Text>
                                  );
                                })()
                              ) : sellColVisible ? (
                                (() => {
                                  const isQueued = row.sellPrice != null && isPlaceOrderQueued("SELL", row.shares, row.sellPrice);
                                  return (
                                    <Tooltip label={isQueued ? "Queued for placement" : "Click to queue"}>
                                      <Badge
                                        variant="filled"
                                        size="md"
                                        fw={700}
                                        style={{
                                          background: isQueued
                                            ? "rgba(251,146,60,0.9)"
                                            : bufferMissing
                                              ? "rgba(251,146,60,0.9)"
                                              : "var(--mantine-color-red-7)",
                                          color: "#fff",
                                          cursor:
                                            row.sellPrice != null
                                              ? "pointer"
                                              : "default",
                                          ...(isMobile ? { paddingInline: 8 } : {}),
                                        }}
                                        leftSection={isQueued ? <IconClock size={12} /> : undefined}
                                        onClick={() => {
                                          if (row.sellPrice == null || isQueued) return;
                                          isTastytrade
                                            ? directQueueOrder(
                                                "SELL",
                                                row.shares,
                                                row.sellPrice,
                                              )
                                            : row.buyPrice != null &&
                                              setTosModal({
                                                text: buildTosText(
                                                  "SELL",
                                                  row.shares,
                                                  row.buyPrice,
                                                  row.sellPrice,
                                                  4,
                                                ),
                                              });
                                        }}
                                      >
                                        {isQueued ? "" : "+"}
                                      </Badge>
                                    </Tooltip>
                                  );
                                })()
                              ) : null}
                            </div>
                          </Table.Td>
                          <Table.Td ta="center">
                            <Text size="sm" c="dimmed">
                              {row.buyPrice != null
                                ? mask(`$${fmt(row.buyPrice)}`)
                                : "—"}
                            </Text>
                          </Table.Td>
                          <Table.Td ta="center">
                            <Text size="sm" c="dimmed">
                              {row.sellPrice != null
                                ? mask(`$${fmt(row.sellPrice)}`)
                                : "—"}
                            </Text>
                          </Table.Td>
                          <Table.Td ta="center" className="hide-mobile">
                            <Text size="sm" c="dimmed">
                              {cost != null ? mask(`$${fmt(cost)}`) : "—"}
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                        {priceInRange && <ProgressRow progress={progress} color={progressColor} paddingTop={0} paddingBottom={6} />}
                        </Fragment>
                      );
                    })}
                  </>
                );
              })()}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Stack>

      {isTastytrade && (
        <OrderQueue
          items={queueItems}
          onClear={() => { setQueuedPlaceOrders([]); setQueuedCancelOrders([]); }}
          onSubmit={submitQueue}
          submitting={orderLoading}
          failures={queueErrors}
        />
      )}
    </div>
  );
}
