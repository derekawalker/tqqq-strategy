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
  Menu,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconSettings,
  IconEye,
  IconEyeOff,
  IconRefresh,
  IconChartLine,
  IconRefreshDot,
} from "@tabler/icons-react";
import { useState, useEffect } from "react";
import { useApp } from "@/lib/context/AppContext";
import { useRouter, usePathname } from "next/navigation";

// Live "updated Xs ago" indicator. Re-renders itself every 10s so the relative label stays
// current between refreshes; reads lastRefreshed, which is set on each successful quote fetch.
function LastUpdated() {
  const { lastRefreshed } = useApp();
  // `now` lives in state (not Date.now() during render) so the component stays pure; the
  // interval advances it every 10s to keep the relative label fresh between refreshes.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);
  if (!lastRefreshed) return null;
  const secs = Math.max(0, Math.floor((now - lastRefreshed.getTime()) / 1000));
  const label =
    secs < 10 ? "just now" :
    secs < 60 ? `${secs}s ago` :
    secs < 3600 ? `${Math.floor(secs / 60)}m ago` :
    `${Math.floor(secs / 3600)}h ago`;
  return (
    <Tooltip label={`Last updated ${lastRefreshed.toLocaleTimeString()}`} withArrow>
      <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
        {label}
      </Text>
    </Tooltip>
  );
}

interface AppHeaderProps {
  onRefresh: () => void;
  onSettingsOpen: () => void;
}

export default function AppHeader({ onRefresh, onSettingsOpen }: AppHeaderProps) {
  const { accounts, activeAccount, setActiveAccount, privacyMode, togglePrivacy, quote, schwabConnected, checkSchwabAuth, tastytradeConnected, checkTastytradeAuth, tickQuoteRefresh } = useApp();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const router = useRouter();
  const pathname = usePathname();
  const isAllAccounts = pathname === "/accounts";

  const priceColor = quote.changePercent >= 0 ? "teal" : "red";
  const priceSign = quote.changePercent >= 0 ? "+" : "";

  const priceInfo = (
    <Group gap="xs" wrap="nowrap">
      {isMobile && <LastUpdated />}
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
      {!isMobile && <LastUpdated />}
    </Group>
  );

  const aiProps = {
    variant: "subtle" as const,
    color: "gray.5",
    radius: "md" as const,
    size: "input-xs",
    styles: { root: { background: "rgba(255, 255, 255, 0.05)" } },
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

  // Nothing interactive to connect: OAuth2 replaced the session-token login, and the
  // refresh token is an environment secret. Clicking re-checks the connection.
  const handleTastytradeClick = () => {
    void checkTastytradeAuth();
  };

  const tastytradeLabel = tastytradeConnected === null
    ? "Checking tastytrade…"
    : tastytradeConnected
      ? "tastytrade connected"
      : "tastytrade disconnected — check TASTYTRADE_REFRESH_TOKEN; click to retry";

  const actionIcons = (
    <Group gap={4} wrap="nowrap">
      <Tooltip label={schwabLabel}>
        <ActionIcon
          {...aiProps}
          color={schwabConnected ? "green" : schwabConnected === null ? "gray.5" : "red"}
          onClick={handleSchwabClick}
        >
          <Text size="xs" fw={700} lh={1}>SC</Text>
        </ActionIcon>
      </Tooltip>
      <Tooltip label={tastytradeLabel}>
        <ActionIcon
          {...aiProps}
          color={tastytradeConnected ? "green" : tastytradeConnected === null ? "gray.5" : "red"}
          onClick={handleTastytradeClick}
        >
          <Text size="xs" fw={700} lh={1}>TT</Text>
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Settings">
        <ActionIcon {...aiProps} onClick={onSettingsOpen}>
          <IconSettings size={14} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={privacyMode ? "Show values" : "Privacy mode"}>
        <ActionIcon {...aiProps} onClick={togglePrivacy}>
          {privacyMode ? <IconEyeOff size={14} /> : <IconEye size={14} />}
        </ActionIcon>
      </Tooltip>
      <Menu position="bottom-end" withinPortal radius="sm">
        <Menu.Target>
          <ActionIcon {...aiProps}>
            <IconRefresh size={14} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item leftSection={<IconChartLine size={14} />} onClick={() => tickQuoteRefresh()}>
            Refresh market
          </Menu.Item>
          <Menu.Item leftSection={<IconRefreshDot size={14} />} onClick={onRefresh}>
            Refresh accounts
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Group>
  );

  const headerBg = !isAllAccounts && activeAccount
    ? `color-mix(in srgb, var(--mantine-color-${activeAccount.color}-7) 12%, var(--mantine-color-dark-8))`
    : undefined;

  if (isMobile) {
    return (
      <Group h="100%" px="md" justify="space-between" align="center" wrap="nowrap" style={{ background: headerBg, paddingTop: "env(safe-area-inset-top, 0px)", boxSizing: "border-box" }}>
        {/* Left: title + account select */}
        <Stack gap={8}>
          <Text fw={700} size="sm">TQQQ Strategy</Text>
          <Select
            size="xs"
            radius="sm"
            comboboxProps={{ radius: "sm" }}
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            value={isAllAccounts ? "all" : (activeAccount?.accountNumber ?? null)}
            onChange={(val) => {
              if (val === "all") { router.push("/accounts"); return; }
              const account = accounts.find((a) => a.accountNumber === val);
              if (account) setActiveAccount(account);
            }}
            data={[
              { value: "all", label: "All Accounts" },
              ...accounts.map((a) => ({
                value: a.accountNumber,
                label: privacyMode ? `•••${a.accountNumber.slice(-3)}` : a.accountName,
              })),
            ]}
            styles={{
              input: {
                backgroundColor: "transparent",
                borderColor: "var(--mantine-color-gray-7)",
                color: "var(--mantine-color-gray-3)",
              },
            }}
            w={160}
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
    <Group h="100%" px="md" justify="space-between" align="center" wrap="nowrap" style={{ background: headerBg, paddingTop: "env(safe-area-inset-top, 0px)", boxSizing: "border-box" }}>
      {/* Left: App name + TQQQ price */}
      <Group gap="lg" wrap="nowrap">
        <Text fw={700} size="lg" style={{ whiteSpace: "nowrap" }}>
          TQQQ Strategy
        </Text>
        {priceInfo}
      </Group>

      {/* Right: Accounts + action buttons */}
      <Group gap="xs" wrap="nowrap">
        <Button
          size="xs"
          color="gray.5"
          radius="md"
          variant={isAllAccounts ? "light" : "subtle"}
          onClick={() => router.push("/accounts")}
        >
          All Accounts
        </Button>
        {accounts.map((account) => (
          <Button
            key={account.accountNumber}
            size="xs"
            color={`${account.color}.7`}
            radius={"md"}
            variant={!isAllAccounts && activeAccount?.accountNumber === account.accountNumber ? "light" : "subtle"}
            onClick={() => { setActiveAccount(account); if (isAllAccounts) router.push("/"); }}
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
