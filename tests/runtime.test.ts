import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";

async function freshModel(name: string): Promise<typeof import("../src/model.ts")> {
  return import(new URL(`../src/model.ts?runtime-test=${name}`, import.meta.url).href);
}

async function freshCloudSync(name: string): Promise<typeof import("../src/cloudSync.ts")> {
  return import(new URL(`../src/cloudSync.ts?runtime-test=${name}`, import.meta.url).href);
}

async function freshSyncSchedule(name: string): Promise<typeof import("../src/syncSchedule.ts")> {
  return import(new URL(`../src/syncSchedule.ts?runtime-test=${name}`, import.meta.url).href);
}

async function freshSyncPersistence(name: string): Promise<typeof import("../src/syncPersistence.ts")> {
  return import(new URL(`../src/syncPersistence.ts?runtime-test=${name}`, import.meta.url).href);
}

function useStorage(t: TestContext) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
  return { storage, values };
}

test("successful local saves can be read back without changing training data", async (t) => {
  useStorage(t);
  const model = await freshModel("roundtrip");
  const record = model.createRecord({
    ...model.DEFAULT_FORM,
    date: model.today(),
    module: "言语理解与表达",
    subType: "逻辑填空",
    total: "20",
    correct: "16",
    duration: "15",
    note: "isolated storage test"
  });
  assert.ok(record);
  const settings = { ...model.DEFAULT_SETTINGS, dailyGoal: 100, theme: "dark" as const };

  assert.equal(model.saveRecords([record]), true);
  assert.equal(model.saveSettings(settings), true);
  assert.equal(model.saveSpaceCode("test-only-space"), true);
  assert.deepEqual(model.loadState(), {
    records: [record],
    settings,
    spaceCode: model.normalizeCode("test-only-space")
  });

  assert.equal(model.saveSpaceCode(""), true);
  assert.deepEqual(model.loadState(), { records: [record], settings, spaceCode: "" });
});

test("storage quota failure reports unsaved data and preserves the previous backup", async (t) => {
  const { storage, values } = useStorage(t);
  const model = await freshModel("quota");
  assert.equal(model.saveSettings(model.DEFAULT_SETTINGS), true);
  const beforeFailure = new Map(values);
  t.mock.method(console, "warn", () => {});
  storage.setItem = () => { throw new DOMException("Test quota exceeded", "QuotaExceededError"); };

  assert.equal(model.saveRecords([]), false);
  assert.equal(model.saveSettings({ ...model.DEFAULT_SETTINGS, dailyGoal: 120 }), false);
  assert.equal(model.saveSpaceCode("test-only-space"), false);
  assert.deepEqual(values, beforeFailure);
});

test("a rejected space-code removal does not report a successful disconnect", async (t) => {
  const { storage, values } = useStorage(t);
  const model = await freshModel("remove");
  assert.equal(model.saveSpaceCode("test-only-space"), true);
  const beforeFailure = new Map(values);
  t.mock.method(console, "warn", () => {});
  storage.removeItem = () => { throw new DOMException("Test access denied", "SecurityError"); };

  assert.equal(model.saveSpaceCode(""), false);
  assert.deepEqual(values, beforeFailure);
});

test("disabled storage provides an empty initial state while refusing false save success", async (t) => {
  const { storage } = useStorage(t);
  const model = await freshModel("disabled");
  t.mock.method(console, "warn", () => {});
  storage.getItem = () => { throw new DOMException("Test access denied", "SecurityError"); };
  storage.setItem = () => { throw new DOMException("Test access denied", "SecurityError"); };
  storage.removeItem = () => { throw new DOMException("Test access denied", "SecurityError"); };

  assert.deepEqual(model.loadState(), {
    records: [],
    settings: model.DEFAULT_SETTINGS,
    spaceCode: ""
  });
  assert.equal(model.saveRecords([]), false);
  assert.equal(model.saveSettings(model.DEFAULT_SETTINGS), false);
  assert.equal(model.saveSpaceCode("test-only-space"), false);
});

test("local storage can recover after a temporary write failure", async (t) => {
  const { storage, values } = useStorage(t);
  const model = await freshModel("storage-recovery");
  t.mock.method(console, "warn", () => {});
  storage.setItem = () => { throw new DOMException("Temporary quota failure", "QuotaExceededError"); };
  assert.equal(model.saveSettings({ ...model.DEFAULT_SETTINGS, dailyGoal: 90 }), false);

  storage.setItem = (key: string, value: string) => { values.set(key, value); };
  assert.equal(model.saveSettings({ ...model.DEFAULT_SETTINGS, dailyGoal: 90 }), true);
  assert.equal(model.loadState().settings.dailyGoal, 90);
});

test("cloud sync is never called before all local data has been saved", async () => {
  const persistence = await freshSyncPersistence("local-first-gate");
  const events: string[] = [];
  const failed = await persistence.syncAfterLocalSave(() => {
    events.push("save");
    return false;
  }, async () => {
    events.push("cloud");
    return "unexpected";
  });
  assert.deepEqual(failed, { status: "local-save-failed" });
  assert.deepEqual(events, ["save"]);

  const saved = await persistence.syncAfterLocalSave(() => {
    events.push("save-retry");
    return true;
  }, async () => {
    events.push("cloud-retry");
    return "synthetic-result";
  });
  assert.deepEqual(saved, { status: "synced", value: "synthetic-result" });
  assert.deepEqual(events, ["save", "save-retry", "cloud-retry"]);
});

test("cloud sync retains readable remote records when merging local data", async () => {
  const cloud = await freshCloudSync("merge-retains-remote");
  const remoteRecord = syntheticRecord("synthetic-remote-record", "remote record marker");
  const legacyRemoteRecord = syntheticRecord("synthetic-legacy-hash-record", "legacy hash record marker");
  const localRecord = syntheticRecord("synthetic-local-record", "local record marker");
  const payload = JSON.stringify({ version: 7, records: [remoteRecord], settings: { dailyGoal: 110 } });
  const fetcher = async () => new Response(JSON.stringify([
    { payload, updated_at: "2026-09-23T00:00:00.000Z", space_hash: "synthetic-hash" },
    {
      payload: JSON.stringify({ version: 7, records: [legacyRemoteRecord], settings: syntheticSettings() }),
      updated_at: "2026-09-22T00:00:00.000Z",
      space_hash: "synthetic-legacy-hash"
    }
  ]), { status: 200 });
  const syncSpace = cloud.createSpaceSync({ url: "https://synthetic.invalid", apiKey: "synthetic-public-key", fetcher });

  const merged = await syncSpace("synthetic-space-code", [localRecord], { ...syntheticSettings(), dailyGoal: 80 }, { upload: false });
  assert.deepEqual(merged.records.map((record) => record.id).sort(), [
    "synthetic-legacy-hash-record",
    "synthetic-local-record",
    "synthetic-remote-record"
  ]);
  assert.equal(merged.settings.dailyGoal, 110);
});

test("unreadable remote cloud data blocks replacement instead of erasing older records", async () => {
  const cloud = await freshCloudSync("reject-unreadable-cloud-payload");
  let postCount = 0;
  const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") {
      postCount += 1;
      return new Response(null, { status: 201 });
    }
    return new Response(JSON.stringify([{
      payload: "{malformed legacy payload",
      updated_at: "2026-09-23T00:00:00.000Z",
      space_hash: "synthetic-hash"
    }]), { status: 200 });
  };
  const syncSpace = cloud.createSpaceSync({ url: "https://synthetic.invalid", apiKey: "synthetic-public-key", fetcher });

  await assert.rejects(
    syncSpace("synthetic-space-code", [syntheticRecord("local", "local marker")], syntheticSettings(), { upload: true }),
    /not valid JSON/
  );
  assert.equal(postCount, 0, "a corrupt stored row must never be replaced by an upload");
});

test("training uploads are trailing-debounced and background checks never bypass the merge window", async (t) => {
  const clock = useFakeTimers(t);
  const scheduleModule = await freshSyncSchedule("upload-debounce");
  let uploads = 0;
  let pulls = 0;
  const schedule = scheduleModule.createTrainingSyncSchedule({
    upload: () => { uploads += 1; },
    pull: async () => { pulls += 1; return true; },
    now: clock.now,
    timers: clock.timers
  });

  schedule.scheduleUpload();
  clock.advance(6_000);
  schedule.scheduleUpload();
  clock.advance(9_999);
  assert.equal(uploads, 0);
  schedule.onBackground(true);
  clock.advance(1);
  assert.equal(uploads, 1, "focus or interval work keeps the existing 10 second deadline");
  assert.equal(pulls, 0);
});

test("normal pulls wait two minutes after success and retry immediately after a failed pull", async (t) => {
  const clock = useFakeTimers(t);
  const scheduleModule = await freshSyncSchedule("pull-interval");
  let attempts = 0;
  const schedule = scheduleModule.createTrainingSyncSchedule({
    upload: () => {},
    pull: async () => { attempts += 1; return attempts > 1; },
    now: clock.now,
    timers: clock.timers
  });

  assert.equal(await schedule.pullIfDue(), false);
  assert.equal(await schedule.pullIfDue(), true, "failed pulls do not move the successful-pull deadline");
  clock.advance(119_999);
  assert.equal(await schedule.pullIfDue(), false);
  clock.advance(1);
  assert.equal(await schedule.pullIfDue(), true);
  assert.equal(attempts, 3);
  schedule.resetPullInterval();
  assert.equal(await schedule.pullIfDue(), true, "switching sync spaces allows an immediate pull for the new space");
  assert.equal(attempts, 4);
});

function syntheticRecord(id: string, note: string) {
  return {
    id,
    date: "2026-09-23",
    module: "言语理解与表达",
    subType: "逻辑填空",
    total: 4,
    correct: 3,
    duration: 3,
    errorReason: "无",
    tags: [],
    note,
    reviewStatus: "pending",
    reviewedAt: null,
    createdAt: "2026-09-23T01:00:00.000Z",
    updatedAt: "2026-09-23T01:00:00.000Z",
    deletedAt: null
  };
}

function syntheticSettings() {
  return {
    dailyGoal: 60,
    targetRate: 80,
    examDate: "",
    theme: "light",
    quickTemplates: [],
    updatedAt: "2026-09-23T00:00:00.000Z"
  };
}

function useFakeTimers(t: TestContext) {
  let time = 0;
  let nextId = 1;
  const pending = new Map<number, { callback: () => void; due: number }>();
  const timers = {
    setTimeout: (callback: () => void, delay: number) => {
      const id = nextId++;
      pending.set(id, { callback, due: time + delay });
      return id;
    },
    clearTimeout: (id: number) => { pending.delete(id); }
  };
  t.after(() => pending.clear());
  return {
    now: () => time,
    timers,
    advance: (duration: number) => {
      const target = time + duration;
      while (true) {
        const next = [...pending.entries()].sort((a, b) => a[1].due - b[1].due)[0];
        if (!next || next[1].due > target) break;
        time = next[1].due;
        pending.delete(next[0]);
        next[1].callback();
      }
      time = target;
    }
  };
}
