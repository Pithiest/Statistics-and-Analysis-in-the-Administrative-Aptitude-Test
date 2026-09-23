/** Wait for the newest queued local write, including edits queued while an earlier write was pending. */
export async function waitForStableLocalSave(current: () => Promise<boolean>): Promise<boolean> {
  while (true) {
    const pending = current();
    const saved = await pending;
    if (pending === current()) return saved;
  }
}
