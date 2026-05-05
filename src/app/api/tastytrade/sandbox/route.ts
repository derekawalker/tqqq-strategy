import { readSetting, writeSetting } from "@/lib/settings";
import { SANDBOX } from "@/lib/tastytrade/config";

const KEY = "sandbox_orders";

export async function GET() {
  const stored = await readSetting<boolean>(KEY);
  // Env var is the default when no DB setting exists
  const enabled = stored ?? SANDBOX;
  return Response.json({ enabled });
}

export async function POST(req: Request) {
  const { enabled } = await req.json();
  if (typeof enabled !== "boolean") {
    return Response.json({ error: "enabled must be a boolean" }, { status: 400 });
  }
  await writeSetting(KEY, enabled);
  return Response.json({ enabled });
}
