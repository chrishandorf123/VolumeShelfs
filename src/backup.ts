/**
 * Backup / restore ALL app data. Everything the app remembers — tracked
 * positions, watchlist, benchmark, API keys, sizing, price alerts, settings —
 * lives in localStorage under the "vs." prefix, which is per-origin (and origin
 * includes the port). A one-file backup makes the user independent of that:
 * restore on a new port, a new browser, or a new machine.
 */
const PREFIX = "vs.";

export interface BackupFile {
  app: "VolumeShelfs";
  version: 1;
  savedAt: string;
  data: Record<string, string>;
}

/** Snapshot every vs.* key into a pretty JSON string. */
export function exportBackup(): string {
  const data: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX)) {
      const v = localStorage.getItem(k);
      if (v !== null) data[k] = v;
    }
  }
  const file: BackupFile = {
    app: "VolumeShelfs",
    version: 1,
    savedAt: new Date().toISOString(),
    data,
  };
  return JSON.stringify(file, null, 2);
}

/** Restore keys from a backup JSON string. Returns how many keys were written.
 * Throws on a file that isn't a VolumeShelfs backup. */
export function importBackup(json: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const file = parsed as Partial<BackupFile>;
  if (!file || file.app !== "VolumeShelfs" || typeof file.data !== "object" || file.data === null) {
    throw new Error("That isn't a VolumeShelfs backup file.");
  }
  let n = 0;
  for (const [k, v] of Object.entries(file.data)) {
    if (k.startsWith(PREFIX) && typeof v === "string") {
      localStorage.setItem(k, v);
      n++;
    }
  }
  return n;
}

/** Trigger a browser download of the current backup. */
export function downloadBackup(): void {
  const blob = new Blob([exportBackup()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const stamp = new Date().toISOString().slice(0, 10);
  a.download = `volumeshelfs-backup-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
