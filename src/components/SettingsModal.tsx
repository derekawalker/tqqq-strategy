"use client";

import {
  Modal,
  Stack,
  Text,
  Group,
  ColorSwatch,
  NumberInput,
  Divider,
  SimpleGrid,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { DatePickerInput } from "@mantine/dates";
import { IconCheck } from "@tabler/icons-react";
import { useApp } from "@/lib/context/AppContext";

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

export default function SettingsModal({ opened, onClose }: SettingsModalProps) {
  const { activeAccount, updateAccountColor, updateAccountSettings } = useApp();
  const isMobile = useMediaQuery("(max-width: 768px)");

  if (!activeAccount) {
    return (
      <Modal
        opened={opened}
        onClose={onClose}
        title="Account Settings"
        size="md"
        padding="lg"
      >
        <Text size="sm" c="dimmed">
          Select an account to configure settings.
        </Text>
      </Modal>
    );
  }

  const s = activeAccount.settings;

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
              value={s.startingDate}
              onChange={(val) => {
                if (!val) {
                  updateAccountSettings(activeAccount.accountNumber, {
                    startingDate: null,
                  });
                  return;
                }
                const [y, m, day] =
                  typeof val === "string"
                    ? val.split("-").map(Number)
                    : [
                        (val as Date).getFullYear(),
                        (val as Date).getMonth() + 1,
                        (val as Date).getDate(),
                      ];
                const d = new Date(y, m - 1, day, 12, 0, 0, 0);
                updateAccountSettings(activeAccount.accountNumber, {
                  startingDate: d,
                });
              }}
            />
            <NumberInput
              label="Initial Cash"
              placeholder="0.00"
              prefix="$"
              decimalScale={2}
              step={0.01}
              thousandSeparator=","
              value={s.initialCash ?? ""}
              onChange={(val) =>
                updateAccountSettings(activeAccount.accountNumber, {
                  initialCash: val === "" ? null : Number(val),
                })
              }
            />
          </SimpleGrid>

          <Divider />

          <DatePickerInput
            label="Level Reset Date"
            description="Ignore fills before this date for level detection"
            placeholder="No reset"
            clearable
            value={s.levelResetDate}
            onChange={(val) => {
              if (!val) {
                updateAccountSettings(activeAccount.accountNumber, {
                  levelResetDate: null,
                });
                return;
              }
              const [y, m, day] =
                typeof val === "string"
                  ? val.split("-").map(Number)
                  : [
                      (val as Date).getFullYear(),
                      (val as Date).getMonth() + 1,
                      (val as Date).getDate(),
                    ];
              const d = new Date(y, m - 1, day, 0, 0, 0, 0);
              updateAccountSettings(activeAccount.accountNumber, {
                levelResetDate: d,
              });
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
              value={s.levelStartingCash ?? ""}
              onChange={(val) =>
                updateAccountSettings(activeAccount.accountNumber, {
                  levelStartingCash: val === "" ? null : Number(val),
                })
              }
            />
            <NumberInput
              label="Initial Lot Price"
              placeholder="0.00"
              prefix="$"
              decimalScale={2}
              step={0.01}
              thousandSeparator=","
              value={s.initialLotPrice ?? ""}
              onChange={(val) =>
                updateAccountSettings(activeAccount.accountNumber, {
                  initialLotPrice: val === "" ? null : Number(val),
                })
              }
            />
            <NumberInput
              label="Sell Percentage"
              placeholder="0.00"
              suffix="%"
              decimalScale={2}
              step={0.01}
              value={s.sellPercentage ?? ""}
              onChange={(val) =>
                updateAccountSettings(activeAccount.accountNumber, {
                  sellPercentage: val === "" ? null : Number(val),
                })
              }
            />
            <NumberInput
              label="Reduction Factor"
              placeholder="0.000"
              decimalScale={3}
              step={0.001}
              value={s.reductionFactor ?? ""}
              onChange={(val) =>
                updateAccountSettings(activeAccount.accountNumber, {
                  reductionFactor: val === "" ? null : Number(val),
                })
              }
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
      </Stack>
    </Modal>
  );
}
