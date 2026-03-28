"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Center, Stack, Paper, Text, PasswordInput, Button } from "@mantine/core";
import { Outfit } from "next/font/google";
import { CARD_RADIUS } from "@/lib/cardStyles";

const outfit = Outfit({ subsets: ["latin"] });

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.push("/");
        router.refresh();
      } else {
        setError("Incorrect password.");
      }
    } catch {
      setError("Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Center style={{ minHeight: "100vh", background: "var(--mantine-color-dark-9)" }}>
      <Paper p="xl" radius={CARD_RADIUS} style={{ width: "100%", maxWidth: 360, background: "var(--mantine-color-dark-7)" }}>
        <form onSubmit={handleSubmit}>
          <Stack gap="md">
            <Text className={outfit.className} fw={700} size="xl" ta="center">TQQQ Strategy</Text>
            <PasswordInput
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              error={error}
              autoFocus
            />
            <Button type="submit" loading={loading} fullWidth>
              Unlock
            </Button>
          </Stack>
        </form>
      </Paper>
    </Center>
  );
}
