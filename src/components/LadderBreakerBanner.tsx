"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Alert, Text } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";

interface LadderStatus {
  date: string | null;
  breaker: boolean;
  fragility: number | null;
}

/**
 * App-wide alert when the quick-bear circuit breaker is tripped — i.e. pause new
 * ladder buys. Mounted in the shell so it shows on every page, not just /anomaly.
 * Reads the cached lightweight status endpoint, so it's cheap.
 */
export function LadderBreakerBanner() {
  const [status, setStatus] = useState<LadderStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/anomaly?status=1")
      .then((r) => r.json())
      .then((d) => !cancelled && !d.error && setStatus(d))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status?.breaker) return null;

  return (
    <Alert
      color="red"
      variant="light"
      icon={<IconAlertTriangle size={16} />}
      mb="md"
      styles={{
        root: {
          background: "linear-gradient(135deg, rgba(239,68,68,0.20) 0%, rgba(239,68,68,0.09) 100%)",
          boxShadow: "inset 2px 2px 6px rgba(0,0,0,0.5)",
          border: "none",
        },
        icon: { paddingLeft: 4 },
      }}
      title={
        <Text size="sm" fw={700} c="red.3">
          Crash risk — pause ladder buys
        </Text>
      }
    >
      <Text size="sm" c="gray.4">
        The quick-bear circuit breaker is tripped (fragility {status.fragility?.toFixed(1)} as of{" "}
        {status.date}). Consider holding off on new ladder buys until it clears.{" "}
        <Link href="/anomaly" style={{ color: "var(--mantine-color-red-3)", fontWeight: 600 }}>
          View details →
        </Link>
      </Text>
    </Alert>
  );
}
