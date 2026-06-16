"use client";

import { useState } from "react";
import { Stack, Group, Text, Button, Badge, Table, ScrollArea, ActionIcon, Modal, Alert } from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import { useMediaQuery } from "@mantine/hooks";
import { useApp } from "@/lib/context/AppContext";
import { fmt, createMask } from "@/lib/format";

export interface QueueItem {
  key: string;
  type: "place" | "cancel";
  side: "BUY" | "SELL";
  shares: number;
  price: number;
  onRemove: () => void;
}

/**
 * Shared order-queue panel — sticky at the bottom of the page, used by both the working-orders and
 * optimized-levels pages so they stay visually and behaviorally in sync. Renders nothing when empty.
 * Owns its own submit-confirm modal; the parent supplies the items and the submit/clear handlers.
 */
export function OrderQueue({
  items,
  onClear,
  onSubmit,
  submitting = false,
  failures = [],
}: {
  items: QueueItem[];
  onClear: () => void;
  onSubmit: () => void;
  submitting?: boolean;
  failures?: string[];
}) {
  const isMobile = useMediaQuery("(max-width: 768px)");
  const { privacyMode } = useApp();
  const mask = createMask(privacyMode);
  const [confirm, setConfirm] = useState(false);

  if (items.length === 0) return null;

  const cancels = items.filter((i) => i.type === "cancel").length;
  const places = items.filter((i) => i.type === "place").length;
  const confirmMsg =
    cancels > 0 && places > 0
      ? `Submit ${cancels} cancellation${cancels !== 1 ? "s" : ""} and ${places} new order${places !== 1 ? "s" : ""}?`
      : cancels > 0
        ? `Submit ${cancels} cancellation${cancels !== 1 ? "s" : ""}?`
        : `Submit ${places} new order${places !== 1 ? "s" : ""}?`;

  return (
    <>
      <div style={{ position: "sticky", bottom: isMobile ? 56 : 0, zIndex: 20, marginTop: "auto" }}>
        <Stack
          gap="xs"
          p="sm"
          style={{
            border: "1px solid var(--mantine-color-blue-7)",
            borderRadius: 8,
            background: "var(--mantine-color-dark-7)",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
          }}
        >
          <Group justify="space-between" align="center">
            <Text fw={700} size="xs">
              Queued Orders ({items.length})
              <Text span c="dimmed" fw={400}> · Limit · GTC · Ext Overnight</Text>
            </Text>
            <Button variant="subtle" color="gray" size="compact-xs" onClick={onClear}>Clear All</Button>
          </Group>

          <ScrollArea.Autosize mah={isMobile ? 150 : 220}>
            <Table fz="xs" verticalSpacing={3} horizontalSpacing="xs" withRowBorders={false}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Type</Table.Th>
                  <Table.Th>Side</Table.Th>
                  <Table.Th ta="right">Shares</Table.Th>
                  <Table.Th ta="right">Price</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {items.map((it) => (
                  <Table.Tr key={it.key}>
                    <Table.Td>
                      <Badge size="xs" color={it.type === "cancel" ? "red" : "teal"} variant="light">
                        {it.type === "cancel" ? "Cancel" : "Place"}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" fw={600} c={it.side === "BUY" ? "teal" : "red"}>{it.side}</Text>
                    </Table.Td>
                    <Table.Td ta="right">{mask(fmt(it.shares, 0))}</Table.Td>
                    <Table.Td ta="right">{mask(`$${fmt(it.price)}`)}</Table.Td>
                    <Table.Td ta="right">
                      <ActionIcon size="xs" color={it.type === "cancel" ? "red" : "teal"} variant="subtle" onClick={it.onRemove}>
                        <IconTrash size={13} />
                      </ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea.Autosize>

          {failures.length > 0 && (
            <Alert color="red" variant="light" p="xs">
              {failures.map((f, i) => <Text key={i} size="xs">{f}</Text>)}
            </Alert>
          )}

          <Group justify="flex-end">
            <Button size="xs" loading={submitting} onClick={() => setConfirm(true)}>Submit Queue</Button>
          </Group>
        </Stack>
      </div>

      <Modal opened={confirm} onClose={() => setConfirm(false)} title="Submit Queue" size="sm">
        <Stack gap="md">
          <Text size="sm">{confirmMsg}</Text>
          <Group justify="flex-end">
            <Button variant="subtle" color="gray" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button onClick={() => { setConfirm(false); onSubmit(); }}>Submit</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
