"use client";

import { Modal, Stack, Text, Group, ColorSwatch, NumberInput, Divider } from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { IconCheck } from "@tabler/icons-react";
import { useApp } from "@/lib/context/AppContext";

const COLORS = [
  "red", "pink", "grape", "violet", "indigo", "blue",
  "cyan", "teal", "green", "lime", "yellow", "orange",
];

interface SettingsModalProps {
  opened: boolean;
  onClose: () => void;
}

export default function SettingsModal({ opened, onClose }: SettingsModalProps) {
  const { activeAccount, updateAccountColor, updateAccountSettings } = useApp();

  if (!activeAccount) {
    return (
      <Modal opened={opened} onClose={onClose} title="Settings" size="md">
        <Text size="sm" c="dimmed">Select an account to configure settings.</Text>
      </Modal>
    );
  }

  const s = activeAccount.settings;

  return (
    <Modal opened={opened} onClose={onClose} title="Settings" size="md">
      <Stack gap="lg">
        <div>
          <Text size="sm" fw={600} mb="xs">Account Color</Text>
          <Group gap={6}>
            {COLORS.map((color) => (
              <ColorSwatch
                key={color}
                color={`var(--mantine-color-${color}-7)`}
                size={26}
                style={{ cursor: "pointer" }}
                onClick={() => updateAccountColor(activeAccount.accountNumber, color)}
              >
                {activeAccount.color === color && (
                  <IconCheck size={13} color="white" stroke={3} />
                )}
              </ColorSwatch>
            ))}
          </Group>
        </div>

        <Divider />

        <div>
          <Text size="sm" fw={600} mb="sm">Account Settings</Text>
          <Stack gap="sm">
            <NumberInput
              label="Starting Cash"
              placeholder="0.00"
              prefix="$"
              decimalScale={2}
              thousandSeparator=","
              value={s.startingCash ?? ""}
              onChange={(val) => updateAccountSettings(activeAccount.accountNumber, { startingCash: val === "" ? null : Number(val) })}
            />
            <DatePickerInput
              label="Starting Date"
              placeholder="Pick a date"
              value={s.startingDate}
              onChange={(val) => {
                if (!val) { updateAccountSettings(activeAccount.accountNumber, { startingDate: null }); return; }
                const [y, m, day] = val instanceof Date
                  ? [val.getFullYear(), val.getMonth() + 1, val.getDate()]
                  : (val as string).split("-").map(Number);
                const d = new Date(y, m - 1, day, 12, 0, 0, 0);
                updateAccountSettings(activeAccount.accountNumber, { startingDate: d });
              }}
            />
            <NumberInput
              label="Initial Lot Price"
              placeholder="0.00"
              prefix="$"
              decimalScale={2}
              thousandSeparator=","
              value={s.initialLotPrice ?? ""}
              onChange={(val) => updateAccountSettings(activeAccount.accountNumber, { initialLotPrice: val === "" ? null : Number(val) })}
            />
            <NumberInput
              label="Sell Percentage"
              placeholder="0.00"
              suffix="%"
              decimalScale={2}
              value={s.sellPercentage ?? ""}
              onChange={(val) => updateAccountSettings(activeAccount.accountNumber, { sellPercentage: val === "" ? null : Number(val) })}
            />
            <NumberInput
              label="Reduction Factor"
              placeholder="0.000"
              decimalScale={3}
              step={0.001}
              value={s.reductionFactor ?? ""}
              onChange={(val) => updateAccountSettings(activeAccount.accountNumber, { reductionFactor: val === "" ? null : Number(val) })}
            />
          </Stack>
        </div>
      </Stack>
    </Modal>
  );
}
