import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS, createRecord, dashboard, moduleDetail, today } from "../src/model.ts";
import type { ModuleName, TrainingRecord } from "../src/model.ts";

function dateOffset(offset: number) {
  const date = new Date(`${today()}T12:00:00`);
  date.setDate(date.getDate() - offset);
  const timezoneOffset = date.getTimezoneOffset();
  return new Date(date.getTime() - timezoneOffset * 60_000).toISOString().slice(0, 10);
}

function record(
  id: string,
  offset: number,
  module: ModuleName,
  total: number,
  correct: number,
  overrides: Partial<TrainingRecord> = {}
): TrainingRecord {
  const stamp = `${dateOffset(offset)}T08:00:00.000Z`;
  return {
    id,
    date: dateOffset(offset),
    module,
    subType: module === "常识判断" ? "法律常识" : "逻辑填空",
    total,
    correct,
    duration: total,
    errorReason: correct < total ? "知识盲区" : "无",
    tags: [],
    note: "",
    reviewStatus: correct < total ? "pending" : "reviewed",
    reviewedAt: correct < total ? null : stamp,
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
    ...overrides
  };
}

test("dashboard compares the latest seven days with the previous seven days", () => {
  const result = dashboard(
    [
      record("current", 1, "言语理解与表达", 40, 32),
      record("previous", 8, "言语理解与表达", 20, 12)
    ],
    DEFAULT_SETTINGS
  );

  assert.equal(result.comparison.currentTotal, 40);
  assert.equal(result.comparison.previousTotal, 20);
  assert.equal(result.comparison.volumeDelta, 20);
  assert.equal(result.comparison.rateDelta, 20);
});

test("dashboard exposes review completion and bounded module health", () => {
  const result = dashboard(
    [
      record("reviewed", 0, "常识判断", 20, 15, { reviewStatus: "reviewed", reviewedAt: new Date().toISOString() }),
      record("pending", 2, "常识判断", 20, 10)
    ],
    DEFAULT_SETTINGS
  );

  assert.equal(result.review.total, 2);
  assert.equal(result.review.completed, 1);
  assert.equal(result.review.completionRate, 50);
  const common = result.moduleStats.find((item) => item.name === "常识判断");
  assert.ok(common);
  assert.ok(common.health >= 0 && common.health <= 100);
  assert.equal(typeof common.freshness, "number");
});

test("trend keeps untrained dates empty instead of treating them as zero performance", () => {
  const result = dashboard([record("only", 0, "判断推理", 20, 16)], DEFAULT_SETTINGS);
  const emptyDays = result.trend.filter((item) => item.total === 0);

  assert.ok(emptyDays.length > 0);
  assert.ok(emptyDays.every((item) => item.rate === null && item.pace === null));
});

test("module detail keeps every configured common-knowledge subtype visible", () => {
  const detail = moduleDetail([record("law", 0, "常识判断", 20, 15)], "常识判断", DEFAULT_SETTINGS, "全部题型", "全部");
  const names = detail.subTypes.map((item) => item.name);

  assert.deepEqual(names.sort(), ["政治理论", "法律常识", "科技人文", "经济管理", "综合卷/混刷"].sort());
  assert.equal(detail.subTypes.find((item) => item.name === "法律常识")?.total, 20);
});

test("record creation rejects implausibly large numeric input", () => {
  const base = {
    date: today(),
    module: "常识判断" as const,
    subType: "法律常识",
    total: "20",
    correct: "14",
    duration: "15",
    errorReason: "知识盲区",
    tags: "",
    note: ""
  };

  assert.ok(createRecord(base));
  assert.equal(createRecord({ ...base, total: "1001", correct: "14" }), null);
  assert.equal(createRecord({ ...base, duration: "1441" }), null);
});
