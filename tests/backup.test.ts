import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SETTINGS,
  exportCsv,
  exportTrainingBackup,
  normalizeRecords,
  restoreTrainingBackup
} from "../src/model.ts";
import type { Settings, TrainingRecord } from "../src/model.ts";
import { emptyMistakeNotebook, exportMistakeNotebook, parseMistakeImport } from "../src/mistakes.ts";

function record(id: string, overrides: Partial<TrainingRecord> = {}): TrainingRecord {
  return {
    id,
    date: "2026-09-21",
    module: "资料分析",
    subType: "文字资料",
    total: 20,
    correct: 16,
    duration: 15,
    errorReason: "知识盲区",
    tags: ["合成数据"],
    note: "synthetic training fixture",
    reviewStatus: "pending",
    reviewedAt: null,
    createdAt: "2026-09-21T08:00:00.000Z",
    updatedAt: "2026-09-21T08:00:00.000Z",
    deletedAt: null,
    ...overrides
  };
}

const settings: Settings = { ...DEFAULT_SETTINGS, dailyGoal: 80, theme: "dark" };

test("training JSON export restores records and settings with duplicate IDs collapsed to the newest version", () => {
  const older = record("duplicate", { note: "older", updatedAt: "2026-09-20T08:00:00.000Z" });
  const newer = record("duplicate", { note: "newer", updatedAt: "2026-09-21T08:00:00.000Z" });
  const second = record("second", { date: "2026-09-20", updatedAt: "2026-09-20T12:00:00.000Z" });
  const json = exportTrainingBackup([older, newer, second], settings);
  const restored = restoreTrainingBackup(json, [], DEFAULT_SETTINGS);

  assert.equal(JSON.parse(json).version, 7);
  assert.equal(restored.importedRecordCount, 2);
  assert.equal(restored.records.length, 2);
  assert.equal(restored.records.find((item) => item.id === "duplicate")?.note, "newer");
  assert.equal(restored.settings.dailyGoal, 80);
  assert.equal(restored.settings.theme, "dark");
  assert.equal(restored.importedSettings, true);
});

test("restore accepts supported legacy date and module fields without shifting dates", () => {
  const legacy = [
    {
      id: "legacy-slash-date",
      date: "2026/9/21",
      category: "资料",
      sub_type: "增长率",
      total: 20,
      correct: 16,
      duration: 15,
      created_at: "2026-09-21T08:00:00.000Z"
    },
    {
      id: "legacy-chinese-date",
      trainingDate: "2026年9月20日",
      moduleId: "verbal",
      sub: "逻辑填空",
      total: 20,
      wrong: 4,
      duration: 19,
      created_at: "2026-09-20T08:00:00.000Z"
    },
    {
      id: "legacy-iso-date",
      date: "2026-09-19T22:00:00.000Z",
      module: "判断推理",
      sub_type: "图形推理",
      total: 10,
      correct: 8,
      duration: 10,
      created_at: "2026-09-19T08:00:00.000Z"
    }
  ];
  const restored = restoreTrainingBackup(JSON.stringify(legacy), [], DEFAULT_SETTINGS);

  assert.deepEqual(restored.records.map(({ id, date, module }) => ({ id, date, module })), [
    { id: "legacy-slash-date", date: "2026-09-21", module: "资料分析" },
    { id: "legacy-chinese-date", date: "2026-09-20", module: "言语理解与表达" },
    { id: "legacy-iso-date", date: "2026-09-19", module: "判断推理" }
  ]);
  assert.equal(restored.records.find((item) => item.id === "legacy-chinese-date")?.correct, 16);
});

test("invalid calendar dates are rejected instead of being kept or replaced with today's date", () => {
  const invalid = record("bad-date", { date: "2026-02-31" });
  assert.deepEqual(normalizeRecords([invalid]), []);
  assert.throws(() => restoreTrainingBackup(JSON.stringify([invalid]), [], DEFAULT_SETTINGS), /日期损坏/);
});

test("damaged, unrecognized, and wrong-kind files leave prior records and settings untouched", () => {
  const existing = [record("existing")];
  const existingSettings = { ...settings, examDate: "2027-01-01" };
  const originalRecords = structuredClone(existing);
  const originalSettings = structuredClone(existingSettings);
  const damaged = [
    "{ broken json",
    JSON.stringify({ version: 7, records: { not: "an array" }, settings: { theme: "light" } }),
    JSON.stringify([record("unrecognized", { date: "2026-02-31" })]),
    JSON.stringify({ schemaVersion: 1, questions: [], lastImportedAt: null }),
    JSON.stringify({ schemaVersion: 1, practices: [] })
  ];

  for (const input of damaged) {
    assert.throws(() => restoreTrainingBackup(input, existing, existingSettings));
    assert.deepEqual(existing, originalRecords);
    assert.deepEqual(existingSettings, originalSettings);
  }
  assert.throws(() => restoreTrainingBackup(damaged[3], existing, existingSettings), /错题本备份/);
  assert.throws(() => restoreTrainingBackup(damaged[4], existing, existingSettings), /粉笔练习记录/);
});

test("mistake-book import rejects training backups without changing the notebook", () => {
  const notebook = emptyMistakeNotebook();
  const before = structuredClone(notebook);
  const trainingJson = exportTrainingBackup([record("training-only")], settings);

  assert.throws(() => parseMistakeImport(trainingJson, notebook), /训练备份/);
  assert.deepEqual(notebook, before);
  assert.equal(JSON.parse(exportMistakeNotebook(notebook)).schemaVersion, 1);
});

test("CSV quotes content and marks formula-like text as literal", () => {
  const csv = exportCsv([record("csv", {
    note: '=HYPERLINK("https://example.invalid")',
    tags: ["comma, quote\" and newline\nvalue"]
  })]);

  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"\'=HYPERLINK(""https://example.invalid"")"'));
  assert.ok(csv.includes('"comma, quote"" and newline\nvalue"'));
});
