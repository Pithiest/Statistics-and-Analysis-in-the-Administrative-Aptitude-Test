export async function syncAfterLocalSave<T>(saveLocal: () => boolean, syncCloud: () => Promise<T>) {
  if (!saveLocal()) return { status: "local-save-failed" as const };
  return { status: "synced" as const, value: await syncCloud() };
}
