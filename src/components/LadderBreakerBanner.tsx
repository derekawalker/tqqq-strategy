"use client";

import { useEffect, useState } from "react";
import { Alert, Text } from "@mantine/core";
import { IconAlertTriangle, IconArrowDown, IconArrowUp } from "@tabler/icons-react";
import type { ThrottleMode } from "@/lib/throttle";

interface LadderStatus {
  date: string | null;
  mode: ThrottleMode;
  rate: number;
  fragility: number | null;
}

/**
 * App-wide alert for today's buy-side posture when it isn't "full" — i.e. slow,
 * pause, or a bottom redeploy. Mounted in the shell so it shows on every page,
 * not just /anomaly. Reads the cached lightweight status endpoint, so it's cheap.
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

  if (!status || status.mode === "full") return null;

  const frag = status.fragility?.toFixed(1) ?? "—";
  const meta: Record<Exclude<ThrottleMode, "full">, { color: string; icon: React.ReactNode; title: string; body: string }> = {
    slow: {
      color: "yellow",
      icon: <IconAlertTriangle size={16} />,
      title: "Stress building — half-size buys",
      body: `Fragility ${frag}. Scale new ladder buys to half size to start saving dry powder.`,
    },
    pause: {
      color: "red",
      icon: <IconArrowDown size={16} />,
      title: "Crash risk — pause ladder buys",
      body: `Fragility ${frag}. Hold off on new buys so you don't deploy into a falling knife — keep all your TQQQ until a bottom is confirmed.`,
    },
    redeploy: {
      color: "teal",
      icon: <IconArrowUp size={16} />,
      title: "Bottom signal — resume buying",
      body: `Capitulation low confirmed (fragility ${frag}). Resume the ladder and redeploy the dry powder you saved to catch the bounce.`,
    },
  };
  const m = meta[status.mode];
  const rgb = status.mode === "pause" ? "239,68,68" : status.mode === "slow" ? "234,179,8" : "20,184,166";

  return (
    <Alert
      color={m.color}
      variant="light"
      icon={m.icon}
      mb="md"
      styles={{
        root: {
          background: `linear-gradient(135deg, rgba(${rgb},0.20) 0%, rgba(${rgb},0.09) 100%)`,
          boxShadow: "inset 2px 2px 6px rgba(0,0,0,0.5)",
          border: "none",
        },
        icon: { paddingLeft: 4 },
      }}
      title={
        <Text size="sm" fw={700} c={`${m.color}.3`}>
          {m.title}
        </Text>
      }
    >
      <Text size="sm" c="gray.4">
        {m.body} (as of {status.date})
      </Text>
    </Alert>
  );
}
