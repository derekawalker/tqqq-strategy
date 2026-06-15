import { backupSettings } from "@/lib/settings";

export async function POST() {
  if (process.env.DEMO_MODE === "true") {
    return Response.json({ ok: true });
  }

  try {
    await backupSettings();
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return Response.json({ error: message }, { status: 500 });
  }
}
