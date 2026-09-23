import assert from "node:assert/strict";
import test from "node:test";
import { waitForStableLocalSave } from "../src/localSaveQueue.ts";

test("a failed local write blocks cloud progress until the newest queued write succeeds", async () => {
  let finishFirst!: (saved: boolean) => void;
  let finishLatest!: (saved: boolean) => void;
  let current = new Promise<boolean>((resolve) => { finishFirst = resolve; });
  const first = current;
  const latest = new Promise<boolean>((resolve) => { finishLatest = resolve; });
  const settled = waitForStableLocalSave(() => current);

  await Promise.resolve();
  current = latest;
  finishFirst(false);
  await Promise.resolve();
  finishLatest(true);

  assert.equal(await settled, true);
  assert.notStrictEqual(first, current);
});

test("the result of the latest queued local write is returned", async () => {
  const failed = Promise.resolve(false);
  const saved = Promise.resolve(true);
  assert.equal(await waitForStableLocalSave(() => failed), false);
  assert.equal(await waitForStableLocalSave(() => saved), true);
});
