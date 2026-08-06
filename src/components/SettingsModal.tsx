"use client";

import { useState } from "react";
import {
  Modal,
  Stack,
  Text,
  Group,
  ColorSwatch,
  NumberInput,
  Divider,
  SimpleGrid,
  Button,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { DatePickerInput } from "@mantine/dates";
import { IconCheck } from "@tabler/icons-react";
import { useApp, type AccountSettings } from "@/lib/context/AppContext";
import PushNotificationSettings from "@/components/PushNotificationSettings";

const COLORS = [
  "red",
  "pink",
  "grape",
  "violet",
  "indigo",
  "blue",
  "cyan",
  "teal",
  "green",
  "lime",
  "yellow",
  "orange",
];

interface SettingsModalProps {
  opened: boolean;
  onClose: () => void;
}

const EMPTY_SETTINGS: AccountSettings = {
  initialCash: null,
  levelStartingCash: null,
  startingDate: null,
  initialLotPrice: null,
  sellPercentage: null,
  reductionFactor: null,
  orderWarnBelow: null,
  orderBuffer: null,
  putSafetyLevels: null,
  levelResetDate: null,
  hedgeSettings: null,
};

export default function SettingsModal({ opened, onClose }: SettingsModalProps) {
  const { activeAccount, updateAccountColor, updateAccountSettings } = useApp();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [draft, setDraft] = useState<AccountSettings>(EMPTY_SETTINGS);

  // Re-sync the draft from the active account whenever the modal opens (or the
  // active account changes while open) — adjusted during render, per React docs,
  // rather than in an effect.
  const syncKey = opened ? activeAccount?.accountNumber ?? null : null;
  const [lastSyncKey, setLastSyncKey] = useState<string | null>(null);
  if (syncKey !== lastSyncKey) {
    setLastSyncKey(syncKey);
    if (syncKey && activeAccount) {
      setDraft({ ...EMPTY_SETTINGS, ...activeAccount.settings });
    }
  }

  const handleSave = () => {
    if (!activeAccount) return;
    updateAccountSettings(activeAccount.accountNumber, draft);
    onClose();
  };

  if (!activeAccount) {
    return (
      <Modal
        opened={opened}
        onClose={onClose}
        title="Account Settings"
        size="md"
        padding="lg"
      >
        <Stack gap="lg">
          <Text size="sm" c="dimmed">
            Select an account to configure settings.
          </Text>
          <Divider />
          <PushNotificationSettings />
        </Stack>
      </Modal>
    );
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Account Settings"
      size="md"
      padding="lg"
    >
      <Stack gap="lg">
        <Stack gap="sm">
          <SimpleGrid cols={2} spacing="sm">
            <DatePickerInput
              label="Starting Date"
              placeholder="Pick a date"
              value={draft.startingDate}
              onChange={(val) => {
                if (!val) { setDraft((d) => ({ ...d, startingDate: null })); return; }
                const [y, m, day] =
                  typeof val === "string"
                    ? val.split("-").map(Number)
                    : [(val as Date).getFullYear(), (val as Date).getMonth() + 1, (val as Date).getDate()];
                setDraft((d) => ({ ...d, startingDate: new Date(y, m - 1, day, 12, 0, 0, 0) }));
              }}
            />
            <NumberInput
              label="Initial Cash"
              placeholder="0.00"
              prefix="$"
              decimalScale={2}
              step={0.01}
              thousandSeparator=","
              value={draft.initialCash ?? ""}
              onChange={(val) => setDraft((d) => ({ ...d, initialCash: val === "" ? null : Number(val) }))}
            />
          </SimpleGrid>

          <Divider />

          <DatePickerInput
            label="Level Reset Date"
            description="Ignore fills before this date for level detection"
            placeholder="No reset"
            clearable
            value={draft.levelResetDate}
            onChange={(val) => {
              if (!val) { setDraft((d) => ({ ...d, levelResetDate: null })); return; }
              const [y, m, day] =
                typeof val === "string"
                  ? val.split("-").map(Number)
                  : [(val as Date).getFullYear(), (val as Date).getMonth() + 1, (val as Date).getDate()];
              setDraft((d) => ({ ...d, levelResetDate: new Date(y, m - 1, day, 0, 0, 0, 0) }));
            }}
          />
          <SimpleGrid cols={2} spacing="sm">
            <NumberInput
              label="Level Starting Cash"
              placeholder="0.00"
              prefix="$"
              decimalScale={2}
              step={0.01}
              thousandSeparator=","
              value={draft.levelStartingCash ?? ""}
              onChange={(val) => setDraft((d) => ({ ...d, levelStartingCash: val === "" ? null : Number(val) }))}
            />
            <NumberInput
              label="Initial Lot Price"
              placeholder="0.00"
              prefix="$"
              decimalScale={2}
              step={0.01}
              thousandSeparator=","
              value={draft.initialLotPrice ?? ""}
              onChange={(val) => setDraft((d) => ({ ...d, initialLotPrice: val === "" ? null : Number(val) }))}
            />
            <NumberInput
              label="Sell Percentage"
              placeholder="0.00"
              suffix="%"
              decimalScale={2}
              step={0.01}
              value={draft.sellPercentage ?? ""}
              onChange={(val) => setDraft((d) => ({ ...d, sellPercentage: val === "" ? null : Number(val) }))}
            />
            <NumberInput
              label="Reduction Factor"
              placeholder="0.000"
              decimalScale={3}
              step={0.001}
              value={draft.reductionFactor ?? ""}
              onChange={(val) => setDraft((d) => ({ ...d, reductionFactor: val === "" ? null : Number(val) }))}
            />
          </SimpleGrid>
        </Stack>

        <Divider />

        <div>
          <Text size="sm" fw={600} mb="xs">
            Account Color
          </Text>
          <Group gap={4} justify="space-between">
            {COLORS.map((color) => (
              <ColorSwatch
                key={color}
                color={`var(--mantine-color-${color}-7)`}
                size={isMobile ? 20 : 26}
                style={{ cursor: "pointer", flexShrink: 0 }}
                onClick={() =>
                  updateAccountColor(activeAccount.accountNumber, color)
                }
              >
                {activeAccount.color === color && (
                  <IconCheck
                    size={isMobile ? 10 : 13}
                    color="white"
                    stroke={3}
                  />
                )}
              </ColorSwatch>
            ))}
          </Group>
        </div>

        <Divider />

        <PushNotificationSettings />

        <Button onClick={handleSave} fullWidth>
          Save
        </Button>
      </Stack>
    </Modal>
  );
}
