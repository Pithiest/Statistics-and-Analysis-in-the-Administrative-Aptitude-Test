import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyMistakeNotebook, exportMistakeNotebook, importFenbiExport, loadMistakeNotebook,
  mergeMistakeNotebooks, MISTAKES_STORAGE_KEY, normalizeMistakeNotebook, parseMistakeImport,
  rateMistake, reuseUnchangedSource, saveMistakeNotebook, updateMistakeNote
} from "../src/mistakes.ts";

const DATE = "2026-09-01T10:00:00.000Z";
const NEXT_DATE = "2026-09-02T10:00:00.000Z";
function solution(id: number, overrides: Record<string, unknown> = {}) {
  return { id, content: "<p>合成题干</p>", type: 1, accessories: [{ type: 101, options: ["甲", "乙", "丙", "丁"] }], correctAnswer: { type: 1, choice: "1" }, solution: "<p>合成解析</p>", ...overrides };
}
function fixture() {
  return {
    schemaVersion: 1, exportedAt: DATE, complete: true, missingQuestionIds: [], scope: { subject: "synthetic" }, requestedQuestionIds: ["1", "2", "3"],
    tree: [{ name: "资料分析", questionIds: [1, 2], children: [{ name: "增长", questionIds: [1, 2], children: [] }] }, { name: "未来新模块", questionIds: [3], children: [] }],
    batches: [
      { materials: [{ id: 10, content: "<p>合成材料一</p>" }], solutions: [solution(1, { materialIndexes: [0] }), solution(2, { materialIndexes: [0] })] },
      { materials: [{ id: 20, content: "<p>合成材料二</p>" }], solutions: [solution(1), solution(3, { materialIndexes: [0] })] }
    ],
    answers: [{ questionId: 1, answer: { type: 1, choice: "0" } }]
  };
}

test("Fenbi import deduplicates by stable ID, preserves source categories, and maps materials inside each batch", () => {
  const { notebook, summary } = importFenbiExport(fixture(), undefined, DATE);
  assert.equal(summary.added, 3);
  assert.equal(notebook.questions.length, 3);
  const first = notebook.questions.find(question => question.questionId === "1")!;
  const third = notebook.questions.find(question => question.questionId === "3")!;
  assert.equal(first.id, "fenbi:1");
  assert.deepEqual(first.source.materials, [{ id: "10", html: "<p>合成材料一</p>" }]);
  assert.deepEqual(third.source.materials, [{ id: "20", html: "<p>合成材料二</p>" }]);
  assert.deepEqual(first.source.categoryPaths, [["资料分析", "增长"]]);
  assert.deepEqual(first.source.knowledgePoints, ["增长"]);
  assert.equal(third.source.module, "未来新模块");
  assert.equal(first.source.correctAnswer, "B");
  assert.equal(first.source.originalUserAnswer, "A");
  assert.equal(first.progress.dueAt, null);
});

test("multiple choice, blanks, free text, and accessory content survive normalization", () => {
  const raw = fixture();
  raw.batches = [{ materials: [], solutions: [
    solution(1, { correctAnswer: { type: 2, choice: "0,2" } }),
    solution(2, { correctAnswer: { type: 4, blanks: ["合成填空答案"] }, accessories: [{ type: 104, candidates: [{ name: "候选", candidates: ["合成选词"], desc: "合成说明" }] }] }),
    solution(3, { correctAnswer: { type: 7, backendCorrectAnswer: ["合成文字答案"] }, accessories: [{ type: 107, content: "合成附加题干" }] })
  ] }];
  const { notebook } = importFenbiExport(raw, undefined, DATE);
  assert.equal(notebook.questions[0].source.correctAnswer, "A、C");
  assert.equal(notebook.questions[1].source.answerKind, "blanks");
  assert.match(notebook.questions[1].source.stemHtml, /合成选词/);
  assert.equal(notebook.questions[2].source.answerKind, "text");
  assert.match(notebook.questions[2].source.stemHtml, /合成附加题干/);
});

test("reimport changes source content without resetting notes or review history; old snapshots cannot overwrite current source", () => {
  const first = importFenbiExport(fixture(), undefined, DATE).notebook;
  first.questions[0] = updateMistakeNote(rateMistake(first.questions[0], "good", DATE), "合成复盘笔记", DATE);
  const updated = fixture();
  updated.exportedAt = NEXT_DATE;
  updated.batches[0].solutions[0].content = "<p>合成更新题干内容</p>";
  const second = importFenbiExport(updated, first, NEXT_DATE).notebook;
  assert.deepEqual(second.questions[0].progress, first.questions[0].progress);
  assert.match(second.questions[0].source.stemHtml, /更新/);
  const stale = importFenbiExport(fixture(), second, NEXT_DATE).notebook;
  assert.match(stale.questions[0].source.stemHtml, /更新/);
});

test("complete source removal keeps local data and marks membership; partial missing export never erases membership", () => {
  const first = importFenbiExport(fixture(), undefined, DATE).notebook;
  const next = fixture();
  next.exportedAt = NEXT_DATE;
  next.requestedQuestionIds = ["1"];
  next.tree = [{ name: "资料分析", questionIds: [1], children: [] }];
  next.batches = [{ materials: [], solutions: [solution(1)] }];
  next.complete = false;
  const partial = importFenbiExport(next, first, NEXT_DATE).notebook;
  assert.equal(partial.questions[1].source.inSource, true);
  next.complete = true;
  const complete = importFenbiExport(next, first, NEXT_DATE).notebook;
  assert.equal(complete.questions.length, 3);
  assert.equal(complete.questions[1].source.inSource, false);
  assert.equal(complete.questions[1].source.lastSeenAt, DATE);
  assert.equal(complete.questions[1].source.exportedAt, NEXT_DATE);
});

test("a snapshot claiming completion must contain every requested question before changing absent source membership", () => {
  const first = importFenbiExport(fixture(), undefined, DATE).notebook;
  const next = fixture();
  next.exportedAt = NEXT_DATE;
  next.requestedQuestionIds = ["1", "2"];
  next.tree = [{ name: "资料分析", questionIds: [1, 2], children: [] }];
  next.batches = [{ materials: [], solutions: [solution(1)] }];
  const { notebook, summary } = importFenbiExport(next, first, NEXT_DATE);
  assert.equal(notebook.questions.length, 3);
  assert.equal(notebook.questions[2].source.inSource, true);
  assert.ok(summary.warnings.some(warning => warning.includes("未返回")));
});

test("review ratings schedule actual timestamps with 1/3/7/14/30/60 day progression", () => {
  let question = importFenbiExport(fixture(), undefined, DATE).notebook.questions[0];
  for (const days of [1, 3, 7, 14, 30, 60, 60]) {
    question = rateMistake(question, "good", DATE);
    assert.equal(question.progress.dueAt, new Date(Date.parse(DATE) + days * 86_400_000).toISOString());
  }
  assert.equal(question.progress.stage, 6);
  const hard = rateMistake(question, "hard", DATE);
  assert.equal(hard.progress.dueAt, NEXT_DATE);
  assert.equal(hard.progress.stage, 6);
  const again = rateMistake(question, "again", DATE);
  assert.equal(again.progress.dueAt, "2026-09-01T10:10:00.000Z");
  assert.equal(again.progress.stage, 0);
  assert.equal(rateMistake(again, "good", DATE).progress.stage, 1);
  assert.equal(again.progress.history.length, 8);
});

test("cloud merge uses independent clocks and unions concurrent review events", () => {
  const base = importFenbiExport(fixture(), undefined, DATE).notebook;
  const a = structuredClone(base);
  const b = structuredClone(base);
  a.questions[0] = rateMistake(a.questions[0], "good", DATE);
  b.questions[0] = updateMistakeNote(rateMistake(b.questions[0], "again", NEXT_DATE), "另一设备合成笔记", NEXT_DATE);
  a.questions[0].source = { ...a.questions[0].source, stemHtml: "<p>更新源内容</p>", updatedAt: "2026-09-03T10:00:00.000Z" };
  const merged = mergeMistakeNotebooks(a, b);
  assert.equal(merged.questions[0].source.stemHtml, "<p>更新源内容</p>");
  assert.equal(merged.questions[0].progress.note, "另一设备合成笔记");
  assert.equal(merged.questions[0].progress.history.length, 2);
  assert.equal(merged.questions[0].progress.dueAt, "2026-09-02T10:10:00.000Z");
  assert.deepEqual(mergeMistakeNotebooks(a, b), mergeMistakeNotebooks(b, a));
  assert.deepEqual(mergeMistakeNotebooks(merged, merged), merged);
});

test("a later note edit cannot roll back another device's review; a later review cannot erase the note", () => {
  const base = importFenbiExport(fixture(), undefined, DATE).notebook;
  const notes = structuredClone(base);
  const reviews = structuredClone(base);
  notes.questions[0] = updateMistakeNote(notes.questions[0], "合成跨设备笔记", "2026-09-03T10:00:00.000Z");
  reviews.questions[0] = rateMistake(reviews.questions[0], "good", NEXT_DATE);
  const merged = mergeMistakeNotebooks(notes, reviews);
  assert.equal(merged.questions[0].progress.note, "合成跨设备笔记");
  assert.equal(merged.questions[0].progress.lastReviewedAt, NEXT_DATE);
  assert.equal(merged.questions[0].progress.stage, 1);
  reviews.questions[0] = rateMistake(reviews.questions[0], "good", "2026-09-04T10:00:00.000Z");
  const later = mergeMistakeNotebooks(merged, reviews);
  assert.equal(later.questions[0].progress.note, "合成跨设备笔记");
  assert.equal(later.questions[0].progress.stage, 2);
  assert.equal(later.questions[0].progress.history.length, 2);
});

test("malformed structures are whitelisted, invalid materials skip, HTML stays untrusted data only", () => {
  const raw = fixture();
  raw.batches = [{ materials: [{ id: 11, content: "合成材料" }], solutions: [solution(1, { content: '<img src=x onerror="alert(1)"><script>bad()</script>', materialIndexes: [-1, 100, "0"] }), solution(2, { id: "__proto__" })] }];
  const { notebook, summary } = importFenbiExport(raw, undefined, DATE);
  assert.deepEqual(notebook.questions[0].source.materials, []);
  assert.ok(summary.warnings.length > 0);
  assert.match(notebook.questions[0].source.stemHtml, /onerror/);
  const poisoned = JSON.parse(exportMistakeNotebook(notebook));
  poisoned.questions[0].progress = { note: { toString: "bad" }, stage: 9999, dueAt: "bad", history: [{ id: "fake", rating: "execute", reviewedAt: DATE }], updatedAt: "bad", __proto__: { polluted: true } };
  poisoned.questions[0].source.provider = "unsupported";
  assert.equal(normalizeMistakeNotebook(poisoned).questions.some(question => question.questionId === "1"), false);
  poisoned.questions[0].source.provider = "fenbi";
  const normalized = normalizeMistakeNotebook(poisoned);
  assert.equal(normalized.questions[0].progress.note, "");
  assert.equal(normalized.questions[0].progress.stage, 6);
  assert.deepEqual(normalized.questions[0].progress.history, []);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized.questions[0].progress, "__proto__"), false);
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
});

test("website JSON backup roundtrips and failed import does not mutate existing data", () => {
  const first = importFenbiExport(fixture(), undefined, DATE).notebook;
  const copy = structuredClone(first);
  assert.deepEqual(parseMistakeImport(exportMistakeNotebook(first)).notebook, first);
  assert.throws(() => parseMistakeImport("{invalid", first));
  assert.throws(() => parseMistakeImport('{"schemaVersion":99,"questions":[]}', first));
  assert.deepEqual(first, copy);
  assert.equal(parseMistakeImport(JSON.stringify(fixture()), emptyMistakeNotebook(), DATE).summary.total, 3);
});

test("independent local save reports failure and retains previous notebook without touching training keys", t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map([["training-records", "preserved"]]);
  const storage = { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value); } };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor); else Reflect.deleteProperty(globalThis, "localStorage"); });
  const notebook = importFenbiExport(fixture(), undefined, DATE).notebook;
  assert.equal(saveMistakeNotebook(notebook), true);
  assert.deepEqual(loadMistakeNotebook(), notebook);
  const before = values.get(MISTAKES_STORAGE_KEY);
  storage.setItem = () => { throw new Error("Synthetic quota failure"); };
  assert.equal(saveMistakeNotebook(emptyMistakeNotebook()), false);
  assert.equal(values.get(MISTAKES_STORAGE_KEY), before);
  assert.equal(values.get("training-records"), "preserved");
});

test("unchanged source keeps the previous version despite polling timestamps and question order", () => {
  const previous = importFenbiExport(fixture(), undefined, DATE).notebook;
  const refreshed = fixture();
  refreshed.exportedAt = NEXT_DATE;
  const next = importFenbiExport(refreshed, previous, NEXT_DATE).notebook;
  next.questions.reverse();
  next.questions[0].source = Object.fromEntries(Object.entries(next.questions[0].source).reverse()) as typeof next.questions[number]["source"];
  assert.notEqual(next.lastImportedAt, previous.lastImportedAt);
  assert.strictEqual(reuseUnchangedSource(previous, next), previous);
  assert.equal(reuseUnchangedSource(previous, next).lastImportedAt, DATE);
  assert.equal(next.lastImportedAt, NEXT_DATE, "Comparison must not mutate the incoming snapshot");
});

test("source changes to membership, answers, materials, classification, or content create a new version", () => {
  const previous = importFenbiExport(fixture(), undefined, DATE).notebook;
  const changes: Array<(source: typeof previous.questions[number]["source"]) => void> = [
    source => { source.inSource = false; },
    source => { source.stemHtml += "更新"; },
    source => { source.solutionHtml += "更新"; },
    source => { source.options[0].html = "新选项"; },
    source => { source.correctAnswer = "D"; },
    source => { source.originalUserAnswer = "C"; },
    source => { source.correctAnswerRaw.choice = "3"; },
    source => { source.originalUserAnswerRaw.choice = "2"; },
    source => { source.materials[0].html = "新材料"; },
    source => { source.module = "新的源模块"; },
    source => { source.knowledgePoints.push("新增知识点"); },
    source => { source.categoryPaths[0].push("新增分类"); },
    source => { source.sourceLabel = "新来源"; },
    source => { source.answerKind = "text"; },
    source => { source.questionType = 7; },
    source => { source.subject = "new-subject"; }
  ];
  for (const change of changes) {
    const next = structuredClone(previous);
    next.lastImportedAt = NEXT_DATE;
    change(next.questions[0].source);
    assert.strictEqual(reuseUnchangedSource(previous, next), next);
  }
  const removed = { ...previous, questions: previous.questions.slice(1), lastImportedAt: NEXT_DATE };
  assert.strictEqual(reuseUnchangedSource(previous, removed), removed);
  const replaced = structuredClone(previous);
  replaced.questions[0].id = "fenbi:999";
  replaced.questions[0].questionId = "999";
  assert.strictEqual(reuseUnchangedSource(previous, replaced), replaced);
});
