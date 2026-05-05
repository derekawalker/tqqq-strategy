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
  Modal,
  PinInput,
} from "@mantine/core";
import { useMediaQuery, useDisclosure } from "@mantine/hooks";
import {
  IconSettings,
  IconEye,
  IconEyeOff,
  IconRefresh,
  IconChartLine,
  IconRefreshDot,
} from "@tabler/icons-react";
import { useState } from "react";
import { useApp } from "@/lib/context/AppContext";
import { useRouter, usePathname } from "next/navigation";

interface AppHeaderProps {
  onRefresh: () => void;
  onSettingsOpen: () => void;
}

export default function AppHeader({ onRefresh, onSettingsOpen }: AppHeaderProps) {
  const { accounts, activeAccount, setActiveAccount, privacyMode, togglePrivacy, quote, schwabConnected, checkSchwabAuth, tastytradeConnected, checkTastytradeAuth, tickQuoteRefresh } = useApp();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const router = useRouter();
  const pathname = usePathname();
  const [otpOpen, { open: openOtp, close: closeOtp }] = useDisclosure(false);
  const [otpStep, setOtpStep] = useState<"initiate" | "complete">("initiate");
  const [mfaToken, setMfaToken] = useState("");
  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpLoading, setOtpLoading] = useState(false);
  const isAllAccounts = pathname === "/accounts";

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

  const handleTastytradeClick = () => {
    if (tastytradeConnected) return;
    setOtp("");
    setOtpError(null);
    setOtpStep("initiate");
    openOtp();
  };

  const handleSendSms = async () => {
    setOtpLoading(true);
    setOtpError(null);
    try {
      const res = await fetch("/api/tastytrade/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "initiate" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOtpError(data.error ?? "Login failed — check your credentials in Vercel env vars");
      } else if (data.connected) {
        await checkTastytradeAuth();
        closeOtp();
      } else if (data.mfaToken) {
        setMfaToken(data.mfaToken);
        setOtpStep("complete");
      }
    } finally {
      setOtpLoading(false);
    }
  };

  const handleOtpSubmit = async () => {
    if (otp.length < 6) return;
    setOtpLoading(true);
    setOtpError(null);
    try {
      const res = await fetch("/api/tastytrade/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete", mfaToken, otp }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOtpError("Invalid code — check your SMS and try again");
      } else if (data.success) {
        await checkTastytradeAuth();
        closeOtp();
      }
    } finally {
      setOtpLoading(false);
    }
  };

  const tastytradeLabel = tastytradeConnected === null
    ? "Checking tastytrade…"
    : tastytradeConnected
      ? "tastytrade connected"
      : "tastytrade — click to connect";

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
          <Menu.Item leftSection={<IconChartLine size={14} />} onClick={tickQuoteRefresh}>
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

  const otpModal = (
    <Modal
      opened={otpOpen}
      onClose={closeOtp}
      title="Connect tastytrade"
      centered
      size="sm"
    >
      {otpStep === "initiate" ? (
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Click the button below to send an SMS verification code to your phone.
          </Text>
          {otpError && <Text size="sm" c="red" ta="center">{otpError}</Text>}
          <Button onClick={handleSendSms} loading={otpLoading} color="orange">
            Send SMS code
          </Button>
        </Stack>
      ) : (
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Enter the 6-digit code from your SMS. The app will store a session token
            so you won&apos;t need to do this again.
          </Text>
          <PinInput
            length={6}
            type="number"
            value={otp}
            onChange={setOtp}
            onComplete={handleOtpSubmit}
            disabled={otpLoading}
            mx="auto"
          />
          {otpError && <Text size="sm" c="red" ta="center">{otpError}</Text>}
          <Button
            onClick={handleOtpSubmit}
            loading={otpLoading}
            disabled={otp.length < 6}
            color="orange"
          >
            Connect
          </Button>
        </Stack>
      )}
    </Modal>
  );

  if (isMobile) {
    return (
      <>
        {otpModal}
      <Group h="100%" px="md" justify="space-between" align="center" wrap="nowrap" style={{ background: headerBg }}>
        {/* Left: title + account select */}
        <Stack gap={8}>
          <Text fw={700} size="sm">TQQQ Strategy</Text>
          <Select
            size="xs"
            radius="sm"
            comboboxProps={{ radius: "sm" }}
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
    </>
    );
  }

  return (
    <>
      {otpModal}
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
    </>
  );
}
