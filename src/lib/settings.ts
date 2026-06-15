import { createClient } from "@supabase/supabase-js";

function supabase() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function readSetting<T>(key: string): Promise<T | null> {
  const { data, error } = await supabase()
    .from("settings")
    .select("value")
    .eq("key", key)
    .single();
  if (error || !data) return null;
  return data.value as T;
}

export async function writeSetting<T>(key: string, value: T): Promise<void> {
  await supabase().from("settings").upsert({ key, value });
}

const BACKUP_KEYS = ["accounts", "activeAccountNumber", "balanceHistory"];
const BACKUP_RETENTION_DAYS = 30;

/**
 * Snapshots the keys that hold user configuration into `settings_backups`, keyed by date so
 * repeated calls on the same day overwrite rather than pile up. Older snapshots beyond the
 * retention window are pruned. Lets accidental overwrites of `settings` be recovered manually.
 */
export async function backupSettings(): Promise<void> {
  const sb = supabase();
  const { data, error } = await sb.from("settings").select("key, value").in("key", BACKUP_KEYS);
  if (error || !data) return;

  const value = Object.fromEntries(data.map((row) => [row.key, row.value]));
  const date = new Date().toLocaleDateString("en-CA");
  await sb.from("settings_backups").upsert({ date, value });

  const cutoff = new Date(Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000).toLocaleDateString("en-CA");
  await sb.from("settings_backups").delete().lt("date", cutoff);
}
