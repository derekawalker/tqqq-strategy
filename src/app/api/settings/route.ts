import { NextRequest } from "next/server";
import { readSetting, writeSetting } from "@/lib/settings";
import { DEMO_ACCOUNT_CONFIG } from "@/lib/demo-data";

export async function GET(req: NextRequest) {
  if (process.env.DEMO_MODE === "true") {
    const key = req.nextUrl.searchParams.get("key");
    return Response.json({ value: key === "accounts" ? DEMO_ACCOUNT_CONFIG : null });
  }
  const key = req.nextUrl.searchParams.get("key");
  if (!key) return Response.json({ error: "key required" }, { status: 400 });
  try {
    const value = await readSetting(key);
    return Response.json({ value });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (process.env.DEMO_MODE === "true") {
    return Response.json({ ok: true });
  }

  try {
    const { key, value } = await req.json();
    if (!key) return Response.json({ error: "key required" }, { status: 400 });
    await writeSetting(key, value);
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return Response.json({ error: message }, { status: 500 });
  }
}
