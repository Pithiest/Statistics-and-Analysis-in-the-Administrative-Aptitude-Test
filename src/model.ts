export type ModuleName = "全模块测试" | "言语理解" | "判断推理" | "资料分析" | "数量关系" | "常识判断";
export type ViewId = "today" | "record" | "diagnosis" | "review" | "ledger" | "settings";
export type SyncState = "local" | "syncing" | "synced" | "offline" | "error";
export type Theme = "light" | "dark";

export type TrainingRecord = {
  id: string;
  date: string;
  module: ModuleName;
  subType: string;
  total: number;
  correct: number;
  duration: number;
  errorReason: string;
  tags: string[];
  note: string;
  reviewStatus: "pending" | "reviewed";
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type Settings = {
  dailyGoal: number;
  targetRate: number;
  examDate: string;
  theme: Theme;
  updatedAt: string;
};

export type EntryForm = {
  date: string;
  module: ModuleName;
  subType: string;
  total: string;
  correct: string;
  duration: string;
  errorReason: string;
  tags: string;
  note: string;
};

export type ModuleConfig = {
  id: string;
  name: ModuleName;
  short: string;
  accent: string;
  pace: number;
  subTypes: string[];
};

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://atwsraivphybkfmyeubd.supabase.co";
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_y6wlba5S8qYJebIgnc389Q_zW6pMJnv";

export const MODULES: ModuleConfig[] = [
  { id: "mixed", name: "全模块测试", short: "全测", accent: "#2563eb", pace: 60, subTypes: ["套卷混合", "弱项混合", "限时混合", "考前冲刺"] },
  { id: "verbal", name: "言语理解", short: "言语", accent: "#7c3aed", pace: 48, subTypes: ["中心理解", "逻辑填空", "语句排序", "标题填入", "篇章阅读"] },
  { id: "logic", name: "判断推理", short: "判断", accent: "#0f766e", pace: 55, subTypes: ["图形推理", "定义判断", "类比推理", "逻辑判断", "综合判断"] },
  { id: "data", name: "资料分析", short: "资料", accent: "#b45309", pace: 45, subTypes: ["增长率", "比重", "平均数", "倍数", "综合资料"] },
  { id: "math", name: "数量关系", short: "数量", accent: "#be123c", pace: 70, subTypes: ["工程问题", "行程问题", "排列组合", "概率问题", "经济利润"] },
  { id: "common", name: "常识判断", short: "常识", accent: "#0891b2", pace: 35, subTypes: ["法律", "政治", "经济", "科技", "人文地理"] }
];

export const ERROR_REASONS = ["无", "审题偏差", "知识盲区", "计算失误", "方法不熟", "时间不足", "二选一犹豫"];

export const QUOTES = [
  "先把题做完，再把原因看透。",
  "稳定不是感觉，是每天留下的证据。",
  "错题不是负担，是下一轮提分路线。",
  "少一点模糊判断，多一点可复盘数据。",
  "把弱项拆小，正确率才有地方上升。",
  "限时训练的意义，是让正确率经得起速度。",
  "今天不用证明很多，只要比昨天更清楚一点。"
];

const KEYS = {
  records: "pithiest_xingce_records_v5",
  settings: "pithiest_xingce_settings_v5",
  cloud: "pithiest_xingce_cloud_v5"
};

const OLD_RECORD_KEYS = ["pithiest_xingce_records_v4", "xingce_react_records_v2", "xingce_records", "xingce_v20_records"];
const OLD_SETTINGS_KEYS = ["pithiest_xingce_settings_v4", "xingce_react_settings_v2", "xingce_settings", "xingce_v20_settings"];
const OLD_CLOUD_KEYS = ["pithiest_xingce_cloud_v4", "xingce_react_cloud_v2"];

export const DEFAULT_SETTINGS: Settings = {
  dailyGoal: 80,
  targetRate: 80,
  examDate: "",
  theme: "light",
  updatedAt: new Date().toISOString()
};

export const DEFAULT_FORM: EntryForm = {
  date: "",
  module: "全模块测试",
  subType: "套卷混合",
  total: "100",
  correct: "",
  duration: "90",
  errorReason: "无",
  tags: "",
  note: ""
};

export function today(date = new Date()) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

export function firstSubType(module: ModuleName) {
  return MODULES.find((item) => item.name === module)?.subTypes[0] || "套卷混合";
}

export function shortName(module: ModuleName) {
  return MODULES.find((item) => item.name === module)?.short || "全测";
}

export function accent(module: ModuleName) {
  return MODULES.find((item) => item.name === module)?.accent || "#2563eb";
}

export function suggestedMinutes(module: ModuleName, total: string | number) {
  const count = Number(total);
  const pace = MODULES.find((item) => item.name === module)?.pace || 60;
  if (!Number.isFinite(count) || count <= 0) return "";
  return String(Math.max(1, Math.round((count * pace) / 60)));
}

export function percent(correct: number, total: number) {
  return total > 0 ? Math.round((correct / total) * 100) : 0;
}

export function paceLabel(record: TrainingRecord) {
  if (!record.total || !record.duration) return "--";
  const seconds = (record.duration * 60) / record.total;
  const target = MODULES.find((item) => item.name === record.module)?.pace || 60;
  if (seconds <= target) return "节奏稳定";
  if (seconds <= target * 1.18) return "略慢";
  return "偏慢";
}

export function loadState() {
  const records = normalizeRecords(readJson(KEYS.records) || firstLegacy(OLD_RECORD_KEYS) || []);
  const settings = normalizeSettings(readJson(KEYS.settings) || firstLegacy(OLD_SETTINGS_KEYS) || DEFAULT_SETTINGS);
  const cloud = normalizeCode(String((readJson(KEYS.cloud) || firstLegacy(OLD_CLOUD_KEYS) || {}).spaceCode || ""));
  localStorage.setItem(KEYS.records, JSON.stringify(records));
  localStorage.setItem(KEYS.settings, JSON.stringify(settings));
  if (cloud) localStorage.setItem(KEYS.cloud, JSON.stringify({ spaceCode: cloud }));
  return { records, settings, spaceCode: cloud };
}

export function saveRecords(records: TrainingRecord[]) {
  localStorage.setItem(KEYS.records, JSON.stringify(normalizeRecords(records)));
}

export function saveSettings(settings: Settings) {
  localStorage.setItem(KEYS.settings, JSON.stringify(normalizeSettings(settings)));
}

export function saveSpaceCode(spaceCode: string) {
  const code = normalizeCode(spaceCode);
  if (code) localStorage.setItem(KEYS.cloud, JSON.stringify({ spaceCode: code }));
  else localStorage.removeItem(KEYS.cloud);
}

export function normalizeRecords(input: unknown): TrainingRecord[] {
  if (!Array.isArray(input)) return [];
  const now = new Date().toISOString();
  return input
    .map((raw) => {
      const item = raw as Partial<TrainingRecord> & { error_reason?: string; sub_type?: string; review_status?: string; deleted_at?: string | null };
      const module = normalizeModule(String(item.module || ""));
      const total = clamp(item.total, 0, 9999);
      const correct = clamp(item.correct, 0, total);
      const wrong = Math.max(0, total - correct);
      const errorReason = String(item.errorReason || item.error_reason || "无");
      const reviewStatus: TrainingRecord["reviewStatus"] =
        item.reviewStatus === "reviewed" || item.review_status === "reviewed" || (wrong === 0 && errorReason === "无") ? "reviewed" : "pending";
      return {
        id: String(item.id || crypto.randomUUID()),
        date: validDate(String(item.date || "")),
        module,
        subType: String(item.subType || item.sub_type || firstSubType(module)),
        total,
        correct,
        duration: clamp(item.duration, 0, 9999),
        errorReason,
        tags: normalizeTags(item.tags),
        note: String(item.note || ""),
        reviewStatus,
        createdAt: String(item.createdAt || now),
        updatedAt: String(item.updatedAt || now),
        deletedAt: item.deletedAt || item.deleted_at || null
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt));
}

export function normalizeSettings(input: unknown): Settings {
  const raw = (input || {}) as Partial<Settings>;
  return {
    dailyGoal: clamp(raw.dailyGoal, 10, 500) || DEFAULT_SETTINGS.dailyGoal,
    targetRate: clamp(raw.targetRate, 1, 100) || DEFAULT_SETTINGS.targetRate,
    examDate: validDate(String(raw.examDate || "")),
    theme: raw.theme === "dark" ? "dark" : "light",
    updatedAt: String(raw.updatedAt || new Date().toISOString())
  };
}

export function createRecord(form: EntryForm, previous?: TrainingRecord): TrainingRecord | null {
  const total = Number(form.total);
  const correct = Number(form.correct);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(correct) || correct < 0 || correct > total) return null;
  const now = new Date().toISOString();
  const duration = Number(form.duration) || Number(suggestedMinutes(form.module, form.total)) || 0;
  const shouldReview = correct < total || form.errorReason !== "无";
  return {
    id: previous?.id || crypto.randomUUID(),
    date: validDate(form.date),
    module: form.module,
    subType: form.subType || firstSubType(form.module),
    total: Math.round(total),
    correct: Math.round(correct),
    duration: Math.round(Math.max(0, duration)),
    errorReason: form.errorReason || "无",
    tags: normalizeTags(form.tags),
    note: form.note.trim(),
    reviewStatus: shouldReview ? "pending" : "reviewed",
    createdAt: previous?.createdAt || now,
    updatedAt: now,
    deletedAt: null
  };
}

export function dashboard(records: TrainingRecord[], settings: Settings) {
  const rows = records.filter((item) => !item.deletedAt);
  const todayRows = rows.filter((item) => item.date === today());
  const total = sum(rows, "total");
  const correct = sum(rows, "correct");
  const todayTotal = sum(todayRows, "total");
  const pending = rows.filter((item) => item.reviewStatus === "pending").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const moduleStats = MODULES.map((mod) => {
    const scoped = rows.filter((item) => item.module === mod.name);
    const scopedTotal = sum(scoped, "total");
    const scopedCorrect = sum(scoped, "correct");
    return { ...mod, total: scopedTotal, correct: scopedCorrect, rate: percent(scopedCorrect, scopedTotal), pending: scoped.filter((item) => item.reviewStatus === "pending").length };
  });
  return {
    rows,
    total,
    correct,
    totalRate: percent(correct, total),
    todayTotal,
    todayRate: percent(sum(todayRows, "correct"), todayTotal),
    pending,
    moduleStats,
    trend: makeTrend(rows, 14),
    heatmap: makeHeatmap(rows, 35),
    reasons: aggregateWrong(rows, (item) => item.errorReason).filter((item) => item.name !== "无").slice(0, 6),
    quote: QUOTES[new Date().getDate() % QUOTES.length],
    weak: moduleStats.filter((item) => item.total > 0).sort((a, b) => a.rate - b.rate || b.total - a.total)[0],
    goalDone: Math.min(100, percent(todayTotal, settings.dailyGoal))
  };
}

export function moduleDetail(records: TrainingRecord[], module: ModuleName, settings: Settings) {
  const rows = records.filter((item) => !item.deletedAt && item.module === module);
  const total = sum(rows, "total");
  const correct = sum(rows, "correct");
  const subTypes = aggregate(rows, (item) => item.subType).map((item) => ({ ...item, rate: percent(item.correct, item.total), wrong: item.total - item.correct })).sort((a, b) => a.rate - b.rate || b.wrong - a.wrong);
  const reasons = aggregateWrong(rows, (item) => item.errorReason).filter((item) => item.name !== "无").slice(0, 5);
  const pending = rows.filter((item) => item.reviewStatus === "pending").length;
  const slowCount = rows.filter((item) => paceLabel(item) === "偏慢").length;
  const actions = [
    total ? `${module} 已累计 ${total} 题，当前正确率 ${percent(correct, total)}%。` : "这个模块还没有数据，先录入一组再诊断。",
    subTypes[0] ? `优先复盘「${subTypes[0].name}」，它现在拖累最明显。` : "题型样本不足，先做小题量限时记录。",
    reasons[0] ? `主要错因是「${reasons[0].name}」，复盘时先看同类题。` : "错因暂时干净，继续保持记录。",
    pending ? `还有 ${pending} 条待复盘记录。` : "复盘队列已清空，可以继续训练。",
    slowCount >= 2 ? "最近节奏偏慢，建议下一组减少题量做限时。" : "节奏没有明显异常。"
  ];
  return { rows, total, correct, rate: percent(correct, total), subTypes, reasons, pending, actions, targetRate: settings.targetRate };
}

export function generateCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `XC-${Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0")).join("").slice(0, 10).toUpperCase()}`;
}

export function normalizeCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").replace(/--+/g, "-").slice(0, 32);
}

export async function syncSpace(spaceCode: string, records: TrainingRecord[], settings: Settings) {
  const code = normalizeCode(spaceCode);
  const hash = await hashText(code);
  const remoteRows = await cloudFetch<Array<{ payload: string; updated_at: string }>>(`/rest/v1/xingce_sync?space_hash=eq.${encodeURIComponent(hash)}&select=payload,updated_at&limit=1`);
  const remote = remoteRows[0] ? await parsePayload(remoteRows[0].payload, code) : null;
  const mergedRecords = mergeRecords(records, remote?.records || []);
  const mergedSettings = newerSettings(settings, remote?.settings);
  await cloudFetch("/rest/v1/xingce_sync", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      space_hash: hash,
      payload: await encryptText(JSON.stringify({ version: 5, records: mergedRecords, settings: mergedSettings, updatedAt: new Date().toISOString() }), code),
      updated_at: new Date().toISOString()
    })
  });
  return { records: mergedRecords, settings: mergedSettings };
}

export function exportCsv(records: TrainingRecord[]) {
  const header = ["日期", "模块", "题型", "题量", "正确", "正确率", "用时", "错因", "标签", "备注"];
  return [header, ...records.map((item) => [item.date, item.module, item.subType, item.total, item.correct, `${percent(item.correct, item.total)}%`, item.duration, item.errorReason, item.tags.join(" "), item.note])]
    .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

function mergeRecords(local: TrainingRecord[], remote: TrainingRecord[]) {
  const map = new Map<string, TrainingRecord>();
  [...normalizeRecords(local), ...normalizeRecords(remote)].forEach((item) => {
    const old = map.get(item.id);
    if (!old || item.updatedAt > old.updatedAt) map.set(item.id, item);
  });
  return [...map.values()].sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt));
}

function newerSettings(local: Settings, remote?: Partial<Settings> | null) {
  if (!remote) return local;
  const safe = normalizeSettings(remote);
  return safe.updatedAt > local.updatedAt ? safe : local;
}

async function parsePayload(payload: string, code: string) {
  const text = payload.trim().startsWith("{") ? payload : await decryptText(payload, code);
  try {
    const parsed = JSON.parse(text);
    return { records: normalizeRecords(parsed.records), settings: normalizeSettings(parsed.settings) };
  } catch {
    return null;
  }
}

async function cloudFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });
  if (!response.ok) throw new Error(await response.text());
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

const encoder = new TextEncoder();
const keyCache = new Map<string, CryptoKey>();

async function deriveKey(code: string) {
  const cached = keyCache.get(code);
  if (cached) return cached;
  const material = await crypto.subtle.importKey("raw", encoder.encode(code), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: encoder.encode("xingce-space-sync-v4"), iterations: 100_000, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  keyCache.set(code, key);
  return key;
}

async function encryptText(text: string, code: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await deriveKey(code), encoder.encode(text)));
  return `${toBase64(iv)}.${toBase64(cipher)}`;
}

async function decryptText(payload: string, code: string) {
  const [iv, cipher] = payload.split(".");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(iv) }, await deriveKey(code), fromBase64(cipher));
  return new TextDecoder().decode(plain);
}

async function hashText(text: string) {
  const buffer = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function makeTrend(records: TrainingRecord[], days: number) {
  return Array.from({ length: days }, (_, index) => {
    const date = shiftDate(days - index - 1);
    const scoped = records.filter((item) => item.date === date);
    return { date: date.slice(5), total: sum(scoped, "total"), rate: percent(sum(scoped, "correct"), sum(scoped, "total")) };
  });
}

function makeHeatmap(records: TrainingRecord[], days: number) {
  return Array.from({ length: days }, (_, index) => {
    const date = shiftDate(days - index - 1);
    const total = sum(records.filter((item) => item.date === date), "total");
    return { date, total, level: total >= 100 ? 4 : total >= 70 ? 3 : total >= 35 ? 2 : total > 0 ? 1 : 0 };
  });
}

function aggregate(records: TrainingRecord[], key: (record: TrainingRecord) => string) {
  const map = new Map<string, { name: string; total: number; correct: number }>();
  records.forEach((item) => {
    const name = key(item) || "未分类";
    const current = map.get(name) || { name, total: 0, correct: 0 };
    current.total += item.total;
    current.correct += item.correct;
    map.set(name, current);
  });
  return [...map.values()];
}

function aggregateWrong(records: TrainingRecord[], key: (record: TrainingRecord) => string) {
  const map = new Map<string, { name: string; value: number }>();
  records.forEach((item) => {
    const wrong = Math.max(0, item.total - item.correct);
    if (!wrong) return;
    const name = key(item) || "未分类";
    map.set(name, { name, value: (map.get(name)?.value || 0) + wrong });
  });
  return [...map.values()].sort((a, b) => b.value - a.value);
}

function sum(records: TrainingRecord[], key: "total" | "correct" | "duration") {
  return records.reduce((acc, item) => acc + item[key], 0);
}

function shiftDate(offset: number) {
  const date = new Date();
  date.setDate(date.getDate() - offset);
  return today(date);
}

function readJson(key: string) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

function firstLegacy(keys: string[]) {
  for (const key of keys) {
    const value = readJson(key);
    if (value) return value;
  }
  return null;
}

function normalizeModule(value: string): ModuleName {
  return MODULES.find((item) => item.name === value || item.short === value || item.id === value)?.name || "全模块测试";
}

function normalizeTags(value: unknown) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 8);
  return String(value || "").split(/[，,、\s]+/).map((item) => item.trim()).filter(Boolean).slice(0, 8);
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : today();
}

function clamp(value: unknown, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(min, Math.min(max, Math.round(number)));
}
