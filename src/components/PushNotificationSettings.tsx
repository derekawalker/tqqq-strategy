"use client";

import { useEffect, useState } from "react";
import { Text, Group, Button, Badge } from "@mantine/core";

/** VAPID applicationServerKey must be a Uint8Array, but the env var is base64url. */
function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

type Status = "unsupported" | "checking" | "off" | "on";

/**
 * Device-level Web Push opt-in for hedge monetize/roll, ITM-near-expiry, and
 * ^VXN-band alerts (checked server-side by a Vercel cron hitting
 * /api/push/check). Lives in the settings modal since it's a per-device
 * toggle, not an account setting.
 */
export default function PushNotificationSettings() {
  const [status, setStatus] = useState<Status>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setStatus("unsupported");
        return;
      }
      try {
        // navigator.serviceWorker.ready never resolves if no SW ends up
        // controlling the page (e.g. registration failed silently) — race it
        // against a timeout so the UI can't get stuck on "checking…" forever.
        const reg = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out")), 5000)),
        ]);
        const sub = await reg.pushManager.getSubscription();
        if (!cancelled) setStatus(sub ? "on" : "off");
      } catch {
        if (!cancelled) setStatus("off");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey) throw new Error("Push isn't configured on the server yet");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Notification permission denied");

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      const json = sub.toJSON();
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });
      setStatus("on");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enable notifications");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setStatus("off");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disable notifications");
    } finally {
      setBusy(false);
    }
  };

  if (status === "unsupported") {
    return (
      <Text size="xs" c="dimmed">
        Push notifications aren&apos;t supported in this browser.
      </Text>
    );
  }

  return (
    <div>
      <Group justify="space-between" mb={4}>
        <Text size="sm" fw={600}>Push Notifications</Text>
        <Badge color={status === "on" ? "teal" : "gray"} variant="light" size="sm">
          {status === "checking" ? "checking…" : status === "on" ? "enabled" : "disabled"}
        </Badge>
      </Group>
      <Text size="xs" c="dimmed" mb="xs">
        Hedge monetize/roll alerts, ITM-near-expiry, and ^VXN threshold crossings.
      </Text>
      <Button
        size="xs"
        variant={status === "on" ? "default" : "filled"}
        loading={busy}
        disabled={status === "checking"}
        onClick={status === "on" ? disable : enable}
      >
        {status === "on" ? "Disable" : "Enable"}
      </Button>
      {error && <Text size="xs" c="red" mt={4}>{error}</Text>}
    </div>
  );
}
