"use client";

import { Paper, Text, Stack } from "@mantine/core";
import { Outfit } from "next/font/google";
import { useRouter } from "next/navigation";
import { useCardBg } from "@/lib/hooks/useCardBg";

const outfit = Outfit({ subsets: ["latin"] });

interface StatCardProps {
  label: string;
  value: string | number;
  color?: string;
  href?: string;
}

export function StatCard({ label, value, color = "dark", href }: StatCardProps) {
  const bg = useCardBg(color);
  const router = useRouter();
  return (
    <Paper p="md" radius="md" withBorder onClick={href ? () => router.push(href) : undefined} style={{ background: bg, cursor: href ? "pointer" : undefined }}>
      <Stack gap={8} align="center" justify="center" h="100%">
        <Text size="xs" c="dimmed" tt="uppercase" fw={600} lts={0.5} ta="center">{label}</Text>
        <Text fw={700} lh={1} className={outfit.className} style={{ fontSize: "2.75rem", color: "light-dark(var(--mantine-color-dark-9), white)" }}>
          {value}
        </Text>
      </Stack>
    </Paper>
  );
}
