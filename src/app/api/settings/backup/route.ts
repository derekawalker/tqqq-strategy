import { backupSettings, listBackups, restoreBackup } from "@/lib/settings";

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

/** List available backup dates with the number of balanceHistory entries each has. */
export async function GET() {
  try {
    const backups = await listBackups();
    return Response.json({ backups });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return Response.json({ error: message }, { status: 500 });
  }
}

/** Restore balanceHistory (and optionally other keys) from a specific backup date. */
export async function PUT(request: Request) {
  try {
    const { date, keys } = await request.json();
    if (!date) return Response.json({ error: "date is required" }, { status: 400 });
    await restoreBackup(date, keys);
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return Response.json({ error: message }, { status: 500 });
  }
}
