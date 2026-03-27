"use client";

import { Paper, Text, Stack } from "@mantine/core";
import { Outfit } from "next/font/google";
import { useRouter } from "next/navigation";
import { useCardBg } from "@/lib/hooks/useCardBg";
import { CARD_RADIUS, CARD_LABEL_STYLE } from "@/lib/cardStyles";

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
    <Paper p="md" radius={CARD_RADIUS} onClick={href ? () => router.push(href) : undefined} style={{ background: bg, cursor: href ? "pointer" : undefined }}>
      <Stack gap={8} align="center" justify="center" h="100%">
        <Text c="dimmed" tt="uppercase" fw={600} ta="center" style={CARD_LABEL_STYLE}>{label}</Text>
        <Text fw={700} lh={1} className={outfit.className} style={{ fontSize: "clamp(1.5rem, 6vw, 2.75rem)", color: "white" }}>
          {value}
        </Text>
      </Stack>
    </Paper>
  );
}
