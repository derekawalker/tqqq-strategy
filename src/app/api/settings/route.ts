import { NextRequest } from "next/server";
import { readSetting, writeSetting } from "@/lib/settings";
import { DEMO_ACCOUNT_CONFIG } from "@/lib/demo-data";

// The settings table also holds server-owned rows (push subscriptions, settled
// account history, sync markers). Only these are the browser's to read/write,
// so a client bug can't clobber the rest.
const CLIENT_KEYS = new Set(["accounts", "activeAccountNumber", "balanceHistory"]);

function isClientKey(key: unknown): key is string {
  return typeof key === "string" && CLIENT_KEYS.has(key);
}

function badKey(key: unknown): Response {
  return key
    ? Response.json({ error: "key not allowed" }, { status: 403 })
    : Response.json({ error: "key required" }, { status: 400 });
}

export async function GET(req: NextRequest) {
  if (process.env.DEMO_MODE === "true") {
    const key = req.nextUrl.searchParams.get("key");
    return Response.json({ value: key === "accounts" ? DEMO_ACCOUNT_CONFIG : null });
  }
  const key = req.nextUrl.searchParams.get("key");
  if (!isClientKey(key)) return badKey(key);
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
    if (!isClientKey(key)) return badKey(key);
    await writeSetting(key, value);
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return Response.json({ error: message }, { status: 500 });
  }
}
