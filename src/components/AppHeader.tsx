"use client";

import {
  Group,
  Text,
  Badge,
  Button,
  ActionIcon,
  Tooltip,
  Skeleton,
  Select,
  Stack,
  useMantineColorScheme,
  useComputedColorScheme,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconSettings,
  IconEye,
  IconEyeOff,
  IconRefresh,
  IconSun,
  IconMoon,
  IconPlugConnected,
  IconPlugConnectedX,
} from "@tabler/icons-react";
import { useApp } from "@/lib/context/AppContext";
import { useRouter } from "next/navigation";

interface AppHeaderProps {
  onRefresh: () => void;
  onSettingsOpen: () => void;
}

export default function AppHeader({ onRefresh, onSettingsOpen }: AppHeaderProps) {
  const { accounts, activeAccount, setActiveAccount, privacyMode, togglePrivacy, quote, schwabConnected, checkSchwabAuth } = useApp();
  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme("light");
  const isMobile = useMediaQuery("(max-width: 768px)");
  const router = useRouter();

  const toggleTheme = () =>
    setColorScheme(computedColorScheme === "light" ? "dark" : "light");

  const priceColor = quote.changePercent >= 0 ? "teal" : "red";
  const priceSign = quote.changePercent >= 0 ? "+" : "";

  const priceInfo = (
    <Group gap="xs" wrap="nowrap">
      {quote.loading ? (
        <>
          <Skeleton height={20} width={60} radius="sm" />
          <Skeleton height={20} width={55} radius="sm" />
        </>
      ) : (
        <>
          <Text fw={600} size="sm">
            ${quote.price.toFixed(2)}
          </Text>
          <Badge color={priceColor} variant="light" size="sm">
            {priceSign}{quote.changePercent.toFixed(2)}%
          </Badge>
        </>
      )}
    </Group>
  );

  const aiProps = {
    variant: "outline" as const,
    color: computedColorScheme === "dark" ? "gray.3" : "gray.6",
    styles: { root: { borderColor: computedColorScheme === "dark" ? "var(--mantine-color-gray-7)" : "var(--mantine-color-gray-5)" } },
    size: "input-xs",
  };

  const schwabLabel = schwabConnected === null
    ? "Checking Schwab connection…"
    : schwabConnected
      ? "Schwab connected — click to disconnect"
      : "Schwab disconnected — click to connect";

  const handleSchwabClick = async () => {
    if (schwabConnected) {
      await fetch("/api/auth/logout", { method: "POST" });
      await checkSchwabAuth();
    } else {
      router.push("/api/auth/login");
    }
  };

  const actionIcons = (
    <Group gap={4} wrap="nowrap">
      <Tooltip label={schwabLabel}>
        <ActionIcon
          {...aiProps}
          color={schwabConnected ? "teal" : schwabConnected === null ? "gray.5" : "red.6"}
          onClick={handleSchwabClick}
        >
          {schwabConnected
            ? <IconPlugConnected size={14} />
            : <IconPlugConnectedX size={14} />}
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Settings">
        <ActionIcon {...aiProps} onClick={onSettingsOpen}>
          <IconSettings size={14} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={privacyMode ? "Show values" : "Hide values"}>
        <ActionIcon {...aiProps} onClick={togglePrivacy}>
          {privacyMode ? <IconEyeOff size={14} /> : <IconEye size={14} />}
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Refresh data">
        <ActionIcon {...aiProps} onClick={onRefresh}>
          <IconRefresh size={14} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={computedColorScheme === "light" ? "Dark mode" : "Light mode"}>
        <ActionIcon {...aiProps} onClick={toggleTheme}>
          {computedColorScheme === "light" ? <IconMoon size={14} /> : <IconSun size={14} />}
        </ActionIcon>
      </Tooltip>
    </Group>
  );

  const headerBg = activeAccount
    ? computedColorScheme === "dark"
      ? `color-mix(in srgb, var(--mantine-color-${activeAccount.color}-7) 12%, var(--mantine-color-dark-8))`
      : `var(--mantine-color-${activeAccount.color}-0)`
    : undefined;

  if (isMobile) {
    return (
      <Group h="100%" px="md" justify="space-between" align="center" wrap="nowrap" style={{ background: headerBg }}>
        {/* Left: title + account select */}
        <Stack gap={8}>
          <Text fw={700} size="sm">TQQQ Strategy</Text>
          <Select
            size="xs"
            value={activeAccount?.accountNumber ?? null}
            onChange={(val) => {
              const account = accounts.find((a) => a.accountNumber === val);
              if (account) setActiveAccount(account);
            }}
            data={accounts.map((a) => ({
              value: a.accountNumber,
              label: privacyMode ? `•••${a.accountNumber.slice(-3)}` : a.accountName,
            }))}
            styles={{
              input: {
                backgroundColor: "transparent",
                borderColor: computedColorScheme === "dark" ? "var(--mantine-color-gray-7)" : "var(--mantine-color-gray-5)",
                color: computedColorScheme === "dark" ? "var(--mantine-color-gray-3)" : "var(--mantine-color-gray-7)",
              },
            }}
            w={130}
          />
        </Stack>

        {/* Right: price info + action icons */}
        <Stack gap={8} align="flex-end">
          {priceInfo}
          {actionIcons}
        </Stack>
      </Group>
    );
  }

  return (
    <Group h="100%" px="md" justify="space-between" align="center" wrap="nowrap" style={{ background: headerBg }}>
      {/* Left: App name + TQQQ price */}
      <Group gap="lg" wrap="nowrap">
        <Text fw={700} size="lg" style={{ whiteSpace: "nowrap" }}>
          TQQQ Strategy
        </Text>
        {priceInfo}
      </Group>

      {/* Right: Accounts + action buttons */}
      <Group gap="xs" wrap="nowrap">
        {accounts.map((account) => (
          <Button
            key={account.accountNumber}
            size="xs"
            color={`${account.color}.7`}
            variant={activeAccount?.accountNumber === account.accountNumber ? "filled" : "light"}
            onClick={() => setActiveAccount(account)}
          >
            {privacyMode
              ? `•••${account.accountNumber.slice(-3)}`
              : account.accountName}
          </Button>
        ))}
        {actionIcons}
      </Group>
    </Group>
  );
}
