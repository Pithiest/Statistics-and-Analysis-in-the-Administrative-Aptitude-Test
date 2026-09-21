/** Independent from training totals. All *Html fields are untrusted source HTML. */
export type MistakeRating = "again" | "hard" | "good";
export type MistakeReviewEvent = { id: string; rating: MistakeRating; reviewedAt: string };
export type MistakeAnswer = { type: number | null; choice: string; blanks: string[]; backendCorrectAnswer: string[] };
export type MistakeQuestion = {
  id: string;
  questionId: string;
  source: {
    provider: "fenbi";
    subject: string;
    module: string;
    knowledgePoints: string[];
    categoryPaths: string[][];
    stemHtml: string;
    options: Array<{ label: string; html: string }>;
    correctAnswer: string;
    originalUserAnswer: string;
    correctAnswerRaw: MistakeAnswer;
    originalUserAnswerRaw: MistakeAnswer;
    answerKind: "choice" | "blanks" | "text" | "unknown";
    questionType: number | null;
    solutionHtml: string;
    materials: Array<{ id: string; html: string }>;
    sourceLabel: string;
    exportedAt: string;
    lastSeenAt: string;
    inSource: boolean;
    updatedAt: string;
  };
  progress: {
    note: string;
    noteUpdatedAt: string;
    stage: number;
    dueAt: string | null;
    lastReviewedAt: string | null;
    history: MistakeReviewEvent[];
    updatedAt: string;
  };
};
export type MistakeNotebook = { schemaVersion: 1; questions: MistakeQuestion[]; lastImportedAt: string | null };
export type MistakeImportSummary = { added: number; updated: number; retained: number; total: number; warnings: string[] };

export const MISTAKES_STORAGE_KEY = "pithiest-xingce-mistakes-v1";
export const REVIEW_INTERVAL_DAYS = [1, 3, 7, 14, 30, 60] as const;
const EPOCH = "1970-01-01T00:00:00.000Z";
const MAX_QUESTIONS = 20_000;
const MAX_TEXT = 400_000;
const MAX_JSON_SIZE = 40_000_000;
type UnknownRecord = Record<string, unknown>;

function object(value: unknown): UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}
function list(value: unknown, limit = MAX_QUESTIONS): unknown[] { return Array.isArray(value) ? value.slice(0, limit) : []; }
function string(value: unknown, limit = MAX_TEXT): string { return typeof value === "string" ? value.slice(0, limit) : ""; }
function id(value: unknown): string {
  const candidate = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : string(value, 100);
  return /^[a-zA-Z0-9_-]{1,100}$/.test(candidate) ? candidate : "";
}
function timestamp(value: unknown, fallback = EPOCH): string {
  const parsed = typeof value === "string" && value.length < 50 ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}
function nowTimestamp(value: string | Date = new Date()): string {
  return timestamp(value instanceof Date ? value.toISOString() : value, new Date().toISOString());
}
function latest(a: string | null, b: string | null): string | null { return !a ? b : !b ? a : a > b ? a : b; }
function unique(values: string[]): string[] { return [...new Set(values.filter(Boolean))]; }
function integer(value: unknown): number | null { return typeof value === "number" && Number.isSafeInteger(value) ? value : null; }
function answer(value: unknown): MistakeAnswer {
  const raw = object(value);
  return {
    type: integer(raw.type), choice: string(raw.choice, 1000),
    blanks: list(raw.blanks, 100).map(v => string(v, 10_000)).filter(Boolean),
    backendCorrectAnswer: list(raw.backendCorrectAnswer, 100).map(v => string(v, 10_000)).filter(Boolean)
  };
}
function answerText(value: MistakeAnswer): string {
  if (value.choice) return /^\d+(?:,\d+)*$/.test(value.choice)
    ? value.choice.split(",").map(n => Number(n) < 26 ? String.fromCharCode(65 + Number(n)) : n).join("、")
    : value.choice;
  return (value.blanks.length ? value.blanks : value.backendCorrectAnswer).join("；");
}
function blankProgress(): MistakeQuestion["progress"] {
  return { note: "", noteUpdatedAt: EPOCH, stage: 0, dueAt: null, lastReviewedAt: null, history: [], updatedAt: EPOCH };
}
export function emptyMistakeNotebook(): MistakeNotebook { return { schemaVersion: 1, questions: [], lastImportedAt: null }; }

function pathsByQuestion(rawTree: unknown): Map<string, string[][]> {
  const paths = new Map<string, string[][]>();
  let visited = 0;
  function walk(nodes: unknown[], parent: string[], depth: number) {
    if (depth > 20) return;
    for (const raw of nodes) {
      if (++visited > 30_000) return;
      const node = object(raw);
      const name = string(node.name, 300);
      const path = name ? [...parent, name] : parent;
      for (const rawId of list(node.questionIds)) {
        const qid = id(rawId);
        if (qid && path.length) paths.set(qid, [...(paths.get(qid) || []), path]);
      }
      walk(list(node.children), path, depth + 1);
    }
  }
  walk(list(rawTree), [], 0);
  for (const [qid, candidates] of paths) {
    const distinct = [...new Map(candidates.map(path => [JSON.stringify(path), path])).values()];
    // Parent nodes often repeat every descendant ID; retain the informative paths.
    paths.set(qid, distinct.filter(path => !distinct.some(other => other.length > path.length && path.every((name, i) => name === other[i]))));
  }
  return paths;
}

/** Import a snapshot; absent questions are retained, and incomplete snapshots never remove source membership. */
export function importFenbiExport(rawValue: unknown, existing: MistakeNotebook = emptyMistakeNotebook(), now?: string | Date): { notebook: MistakeNotebook; summary: MistakeImportSummary } {
  const raw = object(rawValue);
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.batches) || !Array.isArray(raw.tree)) throw new Error("这不是支持的粉笔错题导出文件。");
  const importedAt = nowTimestamp(now);
  const exportedAt = timestamp(raw.exportedAt, importedAt);
  const subject = string(object(raw.scope).subject, 100) || "未注明科目";
  const classifications = pathsByQuestion(raw.tree);
  const requestedIds = new Set(list(raw.requestedQuestionIds).map(id).filter(Boolean));
  const answers = new Map(list(raw.answers).map(item => {
    const entry = object(item);
    return [id(entry.questionId), answer(entry.answer)] as const;
  }).filter(([qid]) => qid));
  const imported = new Map<string, MistakeQuestion>();
  const warningCodes = new Set<string>();
  for (const batchValue of list(raw.batches, 5000)) {
    const batch = object(batchValue);
    // Material indexes are batch-local; never resolve them against a global list.
    const materials = list(batch.materials, 1000).map((value, index) => {
      const material = object(value);
      return { id: id(material.id) || `index-${index}`, html: string(material.content) };
    });
    for (const value of list(batch.solutions, 1000)) {
      const row = object(value);
      const qid = id(row.id);
      if (!qid) { warningCodes.add("部分题目缺少有效题号，已跳过。"); continue; }
      if (imported.size >= MAX_QUESTIONS && !imported.has(qid)) throw new Error("单次错题数量过多，请分批导出。");
      const categoryPaths = classifications.get(qid) || [];
      const rawCorrect = answer(row.correctAnswer);
      const originalUserAnswerRaw = answers.get(qid) || answer(null);
      const accessories = list(row.accessories, 100).map(object);
      const rawOptions = accessories.flatMap(accessory => list(accessory.options, 100));
      const attachedContent = accessories.map(accessory => string(accessory.content)).filter(Boolean);
      const candidateContent = accessories.flatMap(accessory => list(accessory.candidates, 100)).map(value => {
        const candidate = object(value);
        return [string(candidate.name), string(candidate.desc), ...list(candidate.candidates, 100).map(value => string(value))].filter(Boolean).join("　");
      }).filter(Boolean);
      const questionMaterials: Array<{ id: string; html: string }> = [];
      for (const index of list(row.materialIndexes, 100)) {
        if (typeof index === "number" && Number.isInteger(index) && index >= 0 && index < materials.length) questionMaterials.push(materials[index]);
        else warningCodes.add("部分材料索引无效，已跳过以避免串题。");
      }
      if (typeof row.material === "string" && row.material) questionMaterials.push({ id: `direct-${qid}`, html: string(row.material) });
      const source: MistakeQuestion["source"] = {
        provider: "fenbi", subject, module: categoryPaths[0]?.[0] || "未分类",
        knowledgePoints: unique(categoryPaths.flatMap(path => path.length > 1 ? path.slice(1) : path)),
        categoryPaths, stemHtml: [string(row.content), ...attachedContent, ...candidateContent].filter(Boolean).join("\n"),
        options: rawOptions.map((option, index) => ({ label: index < 26 ? String.fromCharCode(65 + index) : String(index + 1), html: string(option) })),
        correctAnswer: answerText(rawCorrect), originalUserAnswer: answerText(originalUserAnswerRaw),
        correctAnswerRaw: rawCorrect, originalUserAnswerRaw,
        answerKind: rawCorrect.choice ? "choice" : rawCorrect.blanks.length ? "blanks" : rawCorrect.backendCorrectAnswer.length ? "text" : "unknown",
        questionType: integer(row.type), solutionHtml: string(row.solution),
        materials: [...new Map(questionMaterials.map(material => [material.id, material])).values()],
        sourceLabel: string(row.source, 1000) || string(row.shortSource, 1000),
        exportedAt, lastSeenAt: exportedAt, inSource: true, updatedAt: exportedAt
      };
      const previous = imported.get(qid);
      if (!previous || source.stemHtml.length + source.solutionHtml.length > previous.source.stemHtml.length + previous.source.solutionHtml.length) {
        imported.set(qid, { id: `fenbi:${qid}`, questionId: qid, source, progress: blankProgress() });
      }
    }
  }
  if (!imported.size && requestedIds.size) throw new Error("导出中没有可读取的题目，原错题本已保留。");
  const previous = normalizeMistakeNotebook(existing);
  const oldIds = new Set(previous.questions.map(question => question.questionId));
  const missingRequested = [...requestedIds].some(qid => !imported.has(qid));
  if (missingRequested) warningCodes.add("部分请求的题目未返回，已按不完整来源保留旧题与复习进度。");
  const complete = raw.complete === true && list(raw.missingQuestionIds).length === 0 && !missingRequested;
  const refreshedPrevious = previous.questions.map(question => {
    if (imported.has(question.questionId) || question.source.subject !== subject || question.source.exportedAt > exportedAt) return question;
    const stillListed = requestedIds.has(question.questionId) || classifications.has(question.questionId);
    if (!complete && !stillListed) return question;
    return { ...question, source: { ...question.source, inSource: stillListed, ...(stillListed ? { lastSeenAt: exportedAt } : {}), updatedAt: exportedAt, exportedAt } };
  });
  const notebook = mergeMistakeNotebooks({ ...previous, questions: refreshedPrevious }, { schemaVersion: 1, questions: [...imported.values()], lastImportedAt: importedAt });
  return {
    notebook,
    summary: {
      added: [...imported.keys()].filter(qid => !oldIds.has(qid)).length,
      updated: [...imported.keys()].filter(qid => oldIds.has(qid)).length,
      retained: previous.questions.filter(question => !imported.has(question.questionId)).length,
      total: notebook.questions.length,
      warnings: [...warningCodes, ...(!complete ? ["来源导出尚不完整；未出现的旧题及复习进度已保留。"] : [])]
    }
  };
}

function normalizeQuestion(value: unknown): MistakeQuestion | null {
  const raw = object(value);
  const qid = id(raw.questionId);
  if (!qid) return null;
  const source = object(raw.source);
  const progress = object(raw.progress);
  if (source.provider !== "fenbi") return null;
  const sourceTime = timestamp(source.updatedAt);
  const rawStage = integer(progress.stage) || 0;
  const history = list(progress.history, 50_000).map(value => {
    const event = object(value);
    return { id: string(event.id, 200), rating: event.rating, reviewedAt: timestamp(event.reviewedAt) };
  }).filter((event): event is MistakeReviewEvent => !!event.id && ["again", "hard", "good"].includes(String(event.rating)) && event.reviewedAt !== EPOCH);
  return {
    id: `fenbi:${qid}`, questionId: qid,
    source: {
      provider: "fenbi", subject: string(source.subject, 100), module: string(source.module, 300) || "未分类",
      knowledgePoints: unique(list(source.knowledgePoints, 200).map(value => string(value, 300))),
      categoryPaths: list(source.categoryPaths, 200).map(value => list(value, 21).map(part => string(part, 300)).filter(Boolean)).filter(path => path.length),
      stemHtml: string(source.stemHtml), options: list(source.options, 100).map(value => ({ label: string(object(value).label, 20), html: string(object(value).html) })),
      correctAnswer: string(source.correctAnswer, 20_000), originalUserAnswer: string(source.originalUserAnswer, 20_000),
      correctAnswerRaw: answer(source.correctAnswerRaw), originalUserAnswerRaw: answer(source.originalUserAnswerRaw),
      answerKind: ["choice", "blanks", "text"].includes(String(source.answerKind)) ? source.answerKind as "choice" | "blanks" | "text" : "unknown",
      questionType: integer(source.questionType), solutionHtml: string(source.solutionHtml),
      materials: list(source.materials, 100).map(value => ({ id: string(object(value).id, 100), html: string(object(value).html) })),
      sourceLabel: string(source.sourceLabel, 1000), exportedAt: timestamp(source.exportedAt, sourceTime), lastSeenAt: timestamp(source.lastSeenAt, sourceTime), inSource: source.inSource !== false, updatedAt: sourceTime
    },
    progress: {
      note: string(progress.note, 50_000), noteUpdatedAt: timestamp(progress.noteUpdatedAt, timestamp(progress.updatedAt)),
      stage: Math.max(0, Math.min(REVIEW_INTERVAL_DAYS.length, rawStage)),
      dueAt: progress.dueAt ? timestamp(progress.dueAt) : null,
      lastReviewedAt: progress.lastReviewedAt ? timestamp(progress.lastReviewedAt) : null,
      history: [...new Map(history.map(event => [event.id, event])).values()].sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt) || a.id.localeCompare(b.id)),
      updatedAt: timestamp(progress.updatedAt)
    }
  };
}

/** Whitelist fields rather than spreading imported objects (including prototype-like keys). */
export function normalizeMistakeNotebook(value: unknown): MistakeNotebook {
  const raw = object(value);
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.questions)) throw new Error("错题备份格式不受支持。");
  if (raw.questions.length > MAX_QUESTIONS) throw new Error("错题备份数量过多。");
  const questions = list(raw.questions).map(normalizeQuestion).filter((question): question is MistakeQuestion => question !== null);
  const normalized = new Map<string, MistakeQuestion>();
  for (const question of questions) {
    const previous = normalized.get(question.id);
    normalized.set(question.id, previous ? mergeQuestion(previous, question) : question);
  }
  return { schemaVersion: 1, questions: [...normalized.values()], lastImportedAt: raw.lastImportedAt ? timestamp(raw.lastImportedAt) : null };
}
function chooseNewer<T extends { updatedAt: string }>(a: T, b: T): T {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  // A stable tie-break keeps same-timestamp cross-device merges commutative.
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}
function mergeQuestion(a: MistakeQuestion, b: MistakeQuestion): MistakeQuestion {
  const chosenProgress = chooseNewer(a.progress, b.progress);
  const reviewProgress = (a.progress.lastReviewedAt || EPOCH) === (b.progress.lastReviewedAt || EPOCH)
    ? chosenProgress : (a.progress.lastReviewedAt || EPOCH) > (b.progress.lastReviewedAt || EPOCH) ? a.progress : b.progress;
  const noteProgress = a.progress.noteUpdatedAt === b.progress.noteUpdatedAt
    ? (a.progress.note >= b.progress.note ? a.progress : b.progress)
    : a.progress.noteUpdatedAt > b.progress.noteUpdatedAt ? a.progress : b.progress;
  const history = new Map<string, MistakeReviewEvent>();
  for (const event of [...a.progress.history, ...b.progress.history]) {
    const existing = history.get(event.id);
    if (!existing || JSON.stringify(event) > JSON.stringify(existing)) history.set(event.id, event);
  }
  return {
    id: a.id, questionId: a.questionId, source: chooseNewer(a.source, b.source),
    progress: {
      ...reviewProgress, note: noteProgress.note, noteUpdatedAt: noteProgress.noteUpdatedAt, updatedAt: chosenProgress.updatedAt,
      history: [...history.values()].sort((x, y) => x.reviewedAt.localeCompare(y.reviewedAt) || x.id.localeCompare(y.id))
    }
  };
}
/** Source refreshes and personal study progress use separate clocks. No question is deleted by merge. */
export function mergeMistakeNotebooks(a: MistakeNotebook, b: MistakeNotebook): MistakeNotebook {
  const left = normalizeMistakeNotebook(a);
  const right = normalizeMistakeNotebook(b);
  const questions = new Map(left.questions.map(question => [question.id, question]));
  for (const question of right.questions) {
    const existing = questions.get(question.id);
    questions.set(question.id, existing ? mergeQuestion(existing, question) : question);
  }
  return { schemaVersion: 1, questions: [...questions.values()], lastImportedAt: latest(left.lastImportedAt, right.lastImportedAt) };
}

function canonicalSourceValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalSourceValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonicalSourceValue(child)]));
  }
  return value;
}
function sourceContent(source: MistakeQuestion["source"]): string {
  const content = Object.fromEntries(Object.entries(source).filter(([key]) => !["exportedAt", "lastSeenAt", "updatedAt"].includes(key)));
  return JSON.stringify(canonicalSourceValue(content));
}
/** For source snapshots only: progress is synced separately. A timestamp-only poll must not bump the source version. */
export function reuseUnchangedSource(previous: MistakeNotebook, next: MistakeNotebook): MistakeNotebook {
  if (previous.schemaVersion !== next.schemaVersion || previous.questions.length !== next.questions.length) return next;
  const prior = new Map(previous.questions.map(question => [question.id, question]));
  if (prior.size !== previous.questions.length) return next;
  const seen = new Set<string>();
  for (const question of next.questions) {
    const old = prior.get(question.id);
    if (!old || seen.has(question.id) || old.questionId !== question.questionId || sourceContent(old.source) !== sourceContent(question.source)) return next;
    seen.add(question.id);
  }
  return previous;
}

export function rateMistake(question: MistakeQuestion, rating: MistakeRating, now?: string | Date): MistakeQuestion {
  if (!["again", "hard", "good"].includes(rating)) throw new Error("请选择有效的复习结果。");
  const reviewedAt = nowTimestamp(now);
  const currentStage = Math.max(0, Math.min(REVIEW_INTERVAL_DAYS.length, question.progress.stage));
  const interval = rating === "again" ? 10 * 60_000 : rating === "hard" ? 86_400_000 : REVIEW_INTERVAL_DAYS[Math.min(currentStage, REVIEW_INTERVAL_DAYS.length - 1)] * 86_400_000;
  const event: MistakeReviewEvent = { id: globalThis.crypto?.randomUUID?.() || `${reviewedAt}-${Math.random().toString(36).slice(2)}`, rating, reviewedAt };
  return {
    ...question,
    progress: {
      ...question.progress, stage: rating === "again" ? 0 : rating === "good" ? Math.min(currentStage + 1, REVIEW_INTERVAL_DAYS.length) : currentStage,
      dueAt: new Date(Date.parse(reviewedAt) + interval).toISOString(), lastReviewedAt: reviewedAt,
      history: [...question.progress.history, event], updatedAt: reviewedAt
    }
  };
}
export function updateMistakeNote(question: MistakeQuestion, note: string, now?: string | Date): MistakeQuestion {
  if (question.progress.note === note) return question;
  const updatedAt = nowTimestamp(now);
  return { ...question, progress: { ...question.progress, note: string(note, 50_000), noteUpdatedAt: updatedAt, updatedAt } };
}
export function parseMistakeImport(json: string, existing: MistakeNotebook = emptyMistakeNotebook(), now?: string | Date): { notebook: MistakeNotebook; summary: MistakeImportSummary } {
  if (json.length > MAX_JSON_SIZE) throw new Error("文件超过错题本导入限制，请分批导出。");
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { throw new Error("文件不是有效的 JSON，原错题本已保留。"); }
  if (Array.isArray(object(raw).batches)) return importFenbiExport(raw, existing, now);
  const incoming = normalizeMistakeNotebook(raw);
  const notebook = mergeMistakeNotebooks(existing, incoming);
  const currentIds = new Set(existing.questions.map(question => question.id));
  const incomingIds = new Set(incoming.questions.map(question => question.id));
  return { notebook, summary: { added: incoming.questions.filter(question => !currentIds.has(question.id)).length, updated: incoming.questions.filter(question => currentIds.has(question.id)).length, retained: existing.questions.filter(question => !incomingIds.has(question.id)).length, total: notebook.questions.length, warnings: [] } };
}
export function exportMistakeNotebook(notebook: MistakeNotebook): string { return JSON.stringify(normalizeMistakeNotebook(notebook), null, 2); }
export function loadMistakeNotebook(): MistakeNotebook {
  try {
    const saved = globalThis.localStorage.getItem(MISTAKES_STORAGE_KEY);
    return saved ? normalizeMistakeNotebook(JSON.parse(saved)) : emptyMistakeNotebook();
  } catch { return emptyMistakeNotebook(); }
}
/** A failed write leaves the previous stored backup intact and reports false to the caller. */
export function saveMistakeNotebook(notebook: MistakeNotebook): boolean {
  try { globalThis.localStorage.setItem(MISTAKES_STORAGE_KEY, JSON.stringify(normalizeMistakeNotebook(notebook))); return true; }
  catch { return false; }
}
