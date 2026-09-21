import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";

async function freshModel(name: string): Promise<typeof import("../src/model.ts")> {
  return import(new URL(`../src/model.ts?runtime-test=${name}`, import.meta.url).href);
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

  assert.deepEqual(model.loadState(), {
    records: [],
    settings: model.DEFAULT_SETTINGS,
    spaceCode: ""
  });
  assert.equal(model.saveRecords([]), false);
  assert.equal(model.saveSettings(model.DEFAULT_SETTINGS), false);
  assert.equal(model.saveSpaceCode("test-only-space"), false);
});
