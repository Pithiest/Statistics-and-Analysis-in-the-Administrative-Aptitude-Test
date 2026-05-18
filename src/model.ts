export type ModuleName =
  | "全模块测试"
  | "言语理解与表达"
  | "判断推理"
  | "资料分析"
  | "数量关系"
  | "常识判断";

export type ViewId = "today" | "record" | "diagnosis" | "review" | "ledger" | "settings";
export type SyncState = "local" | "pending" | "syncing" | "synced" | "offline" | "error";
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
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type QuickTemplate = {
  id: string;
  name: string;
  module: ModuleName;
  subType: string;
  total: number | "";
  duration: number | "";
  errorReason: string;
  tags: string;
};

export type Settings = {
  dailyGoal: number;
  targetRate: number;
  examDate: string;
  theme: Theme;
  quickTemplates: QuickTemplate[];
  updatedAt: string;
};

export type EntryForm = {
  date: string;
  module: ModuleName | "";
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
export const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_y6wlba5S8qYJebIgnc389Q_zW6pMJnv";

export const MODULES: ModuleConfig[] = [
  {
    id: "mixed",
    name: "全模块测试",
    short: "全测",
    accent: "#2563eb",
    pace: 60,
    subTypes: ["全套模拟", "混合训练", "错题回炉", "考前冲刺", "综合卷/混刷"]
  },
  {
    id: "verbal",
    name: "言语理解与表达",
    short: "言语",
    accent: "#7c3aed",
    pace: 50,
    subTypes: ["逻辑填空", "中心理解", "细节判断", "语句表达", "篇章阅读", "综合卷/混刷"]
  },
  {
    id: "logic",
    name: "判断推理",
    short: "判断",
    accent: "#0f766e",
    pace: 52.5,
    subTypes: ["图形推理", "定义判断", "类比推理", "逻辑判断", "综合卷/混刷"]
  },
  {
    id: "data",
    name: "资料分析",
    short: "资料",
    accent: "#b45309",
    pace: 60,
    subTypes: ["文字资料", "表格资料", "图形资料", "综合卷/混刷"]
  },
  {
    id: "math",
    name: "数量关系",
    short: "数量",
    accent: "#be123c",
    pace: 90,
    subTypes: ["工程问题", "行程问题", "经济利润", "排列组合", "几何问题", "综合卷/混刷"]
  },
  {
    id: "common",
    name: "常识判断",
    short: "常识",
    accent: "#0891b2",
    pace: 45,
    subTypes: ["政治理论", "法律常识", "科技人文", "经济管理", "综合卷/混刷"]
  }
];

export const ERROR_REASONS = ["无", "粗心看错", "时间紧张", "知识盲区", "方法不熟", "逻辑掉坑", "计算失误", "审题偏差"];

export const QUOTES = [
  "真正能提分的不是做过多少题，而是每一次都知道自己为什么错。",
  "把记录留下来，薄弱点就不会只停留在感觉里。",
  "题量是地基，复盘是楼梯，配速是最后一公里。",
  "今天只要比昨天更清楚一个漏洞，就算没有白练。",
  "先把问题拆小，再把正确率抬稳。",
  "限时不是为了制造紧张，是为了让稳定性经得起考场。",
  "少一点凭感觉，多一点看数据。",
  "错题不丢人，重复错同一种原因才值得警惕。",
  "训练最怕模糊，统计就是把模糊变成可处理的线索。",
  "每一条认真记录，都是下一次少丢分的证据。",
  "别急着怀疑自己，先把问题具体到题型和错因。",
  "做题不是堆数字，是把盲区一点点照亮。",
  "今天的薄弱项，明天就可以变成稳定项。",
  "状态会波动，记录会留下真正的趋势。",
  "先稳住正确率，再把速度一点点压上去。",
  "每一次限时训练，都是在提前熟悉考场压力。",
  "复盘不是重看答案，是找出下次不再掉坑的动作。",
  "能被记录的问题，就已经比模糊焦虑好解决。",
  "别让错题只停在懊恼里，把它变成下一次的提示。",
  "训练的价值，藏在你愿意面对细节的那几分钟里。",
  "分数不会突然变好，但每天的判断会更清楚。",
  "题目做完只是开始，原因看透才算结束。",
  "慢一点没关系，先把每个失分点说清楚。",
  "稳定来自重复，突破来自复盘。",
  "今天少错一个同类问题，就是实打实的进步。",
  "把错因写下来，脑子就不用反复背负模糊压力。",
  "别怕数据不好看，不记录才真的没有方向。",
  "高频错因就是最值得优先解决的提分入口。",
  "一组题练速度，一次复盘练判断。",
  "坚持不是硬撑，是每天都把训练做得更清楚一点。",
  "真正的优势，是知道自己该先补哪一块。",
  "越接近考试，越要相信清晰的数据而不是情绪。",
  "先把能拿的分拿稳，再去挑战更难的部分。",
  "每一次认真修正，都会在下一次答题里出现回报。",
  "别追求完美记录，追求可用记录。",
  "题量给你样本，错因给你方向。",
  "今天的复盘，是明天少犹豫的底气。",
  "练习要有锋利度，知道自己在练什么。",
  "当数据开始说话，焦虑就会小很多。",
  "一套系统不替你考试，但它能帮你少走弯路。",
  "把弱项拆开处理，比一口气否定自己有效得多。",
  "能稳定重复的进步，才是最可靠的进步。",
  "不要和情绪争，和数据一起改。",
  "今天认真一点，考场上就从容一点。",
  "每个模块都有节奏，先看清，再提速。",
  "真正拉开差距的，是别人跳过而你认真复盘的地方。"
];

const KEYS = {
  records: "pithiest_xingce_records_v6",
  settings: "pithiest_xingce_settings_v6",
  cloud: "pithiest_xingce_cloud_v6"
};

const OLD_RECORD_KEYS = [
  "pithiest_xingce_records_v5",
  "pithiest_xingce_records_v4",
  "xingce_react_records_v2",
  "xingce_records",
  "xingce_v20_records",
  "xingce_v19_records",
  "xingce_v18_db",
  "xingce_v17_db",
  "xingce_v16_db",
  "xingce_final_v15",
  "xingce_master_v14",
  "xingce_master_v13"
];
const OLD_SETTINGS_KEYS = [
  "pithiest_xingce_settings_v5",
  "pithiest_xingce_settings_v4",
  "xingce_react_settings_v2",
  "xingce_settings",
  "xingce_v20_settings"
];
const OLD_CLOUD_KEYS = ["pithiest_xingce_cloud_v5", "pithiest_xingce_cloud_v4", "xingce_react_cloud_v2", "xingce_v20_cloud"];

export const DEFAULT_SETTINGS: Settings = {
  dailyGoal: 80,
  targetRate: 80,
  examDate: "",
  theme: "light",
  quickTemplates: [],
  updatedAt: new Date().toISOString()
};

export const DEFAULT_FORM: EntryForm = {
  date: "",
  module: "",
  subType: "",
  total: "",
  correct: "",
  duration: "",
  errorReason: "无",
  tags: "",
  note: ""
};

export function today(date = new Date()) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

export function stampSettings(settings: Settings): Settings {
  return normalizeSettings({ ...settings, updatedAt: new Date().toISOString() });
}

export function moduleConfig(module: ModuleName | "") {
  return MODULES.find((item) => item.name === module);
}

export function isModule(value: string): value is ModuleName {
  return MODULES.some((item) => item.name === value);
}

export function firstSubType(module: ModuleName | "") {
  return moduleConfig(module)?.subTypes[0] || "";
}

export function subTypeOptions(module: ModuleName | "", current = "") {
  const base = moduleConfig(module)?.subTypes || [];
  return current && !base.includes(current) ? [...base, current] : base;
}

export function shortName(module: ModuleName | "") {
  return moduleConfig(module)?.short || "未选";
}

export function accent(module: ModuleName | "") {
  return moduleConfig(module)?.accent || "#2563eb";
}

export function suggestedMinutes(module: ModuleName | "", total: string | number) {
  const count = Number(total);
  const pace = moduleConfig(module)?.pace;
  if (!pace || !Number.isFinite(count) || count <= 0) return "";
  return String(Math.max(1, Math.round((count * pace) / 60)));
}

export function percent(correct: number, total: number) {
  return total > 0 ? Math.round((correct / total) * 100) : 0;
}

export function paceSeconds(record: Pick<TrainingRecord, "total" | "duration">) {
  if (!record.total || !record.duration) return 0;
  return Math.round((record.duration * 60) / record.total);
}

export function paceText(record: Pick<TrainingRecord, "total" | "duration">) {
  const seconds = paceSeconds(record);
  return seconds ? `${seconds}s/题` : "--";
}

export function paceState(record: TrainingRecord) {
  const seconds = paceSeconds(record);
  const target = moduleConfig(record.module)?.pace || 60;
  if (!seconds) return "--";
  if (seconds <= target) return "稳定";
  if (seconds <= target * 1.18) return "略慢";
  return "偏慢";
}

export function avgPace(records: TrainingRecord[]) {
  const total = sum(records, "total");
  const duration = sum(records, "duration");
  return total ? Math.round((duration * 60) / total) : 0;
}

export function loadState() {
  const records = normalizeRecords(readJson(KEYS.records) || firstLegacy(OLD_RECORD_KEYS) || []);
  const settings = normalizeSettings(readJson(KEYS.settings) || firstLegacy(OLD_SETTINGS_KEYS) || DEFAULT_SETTINGS);
  const cloudValue = readJson(KEYS.cloud) || firstLegacy(OLD_CLOUD_KEYS) || {};
  const cloud = normalizeCode(String(cloudValue.spaceCode || ""));
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
  const list = Array.isArray(input) ? input : (input as { records?: unknown[] } | null)?.records;
  if (!Array.isArray(list)) return [];
  const map = new Map<string, TrainingRecord>();
  for (const raw of list) {
    const record = normalizeRecord(raw);
    if (!record) continue;
    const current = map.get(record.id);
    if (!current || record.updatedAt > current.updatedAt) map.set(record.id, record);
  }
  return [...map.values()].sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt));
}

export function normalizeSettings(input: unknown): Settings {
  const raw = (input || {}) as Partial<Settings>;
  return {
    dailyGoal: clamp(raw.dailyGoal, 10, 500) || DEFAULT_SETTINGS.dailyGoal,
    targetRate: clamp(raw.targetRate, 1, 100) || DEFAULT_SETTINGS.targetRate,
    examDate: validDate(String(raw.examDate || ""), ""),
    theme: raw.theme === "dark" ? "dark" : "light",
    quickTemplates: normalizeTemplates(raw.quickTemplates),
    updatedAt: String(raw.updatedAt || new Date().toISOString())
  };
}

export function createRecord(form: EntryForm, previous?: TrainingRecord): TrainingRecord | null {
  if (!form.module || !isModule(form.module)) return null;
  if (!form.subType) return null;
  const total = Number(form.total);
  const correct = Number(form.correct);
  const duration = Number(form.duration);
  if (!Number.isInteger(total) || total <= 0) return null;
  if (!Number.isInteger(correct) || correct < 0 || correct > total) return null;
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const now = new Date().toISOString();
  const errorReason = normalizeReason(form.errorReason);
  const shouldReview = correct < total || errorReason !== "无";
  return {
    id: previous?.id || randomId(),
    date: validDate(form.date, today()),
    module: form.module,
    subType: normalizeSubType(form.subType, form.module),
    total,
    correct,
    duration: Math.round(duration * 10) / 10,
    errorReason,
    tags: normalizeTags(form.tags),
    note: form.note.trim(),
    reviewStatus: shouldReview ? "pending" : "reviewed",
    reviewedAt: shouldReview ? previous?.reviewedAt || null : previous?.reviewedAt || now,
    createdAt: previous?.createdAt || now,
    updatedAt: now,
    deletedAt: null
  };
}

export function templateFromForm(form: EntryForm, name: string): QuickTemplate | null {
  if (!form.module || !isModule(form.module)) return null;
  if (!form.subType) return null;
  return {
    id: randomId(),
    name: (name || `${shortName(form.module)} ${form.total ? `${form.total}题` : "模板"}`).trim().slice(0, 24),
    module: form.module,
    subType: normalizeSubType(form.subType, form.module),
    total: positiveNumber(form.total) || "",
    duration: positiveNumber(form.duration) || "",
    errorReason: normalizeReason(form.errorReason),
    tags: normalizeTags(form.tags).join(" ")
  };
}

export function formFromTemplate(form: EntryForm, template: QuickTemplate): EntryForm {
  return {
    ...form,
    module: template.module,
    subType: normalizeSubType(template.subType, template.module),
    total: template.total === "" ? "" : String(template.total),
    duration: template.duration === "" ? "" : String(template.duration),
    errorReason: normalizeReason(template.errorReason),
    tags: template.tags || ""
  };
}

export function dashboard(records: TrainingRecord[], settings: Settings) {
  const rows = active(records);
  const todayRows = rows.filter((item) => item.date === today());
  const total = sum(rows, "total");
  const correct = sum(rows, "correct");
  const todayTotal = sum(todayRows, "total");
  const pending = rows.filter((item) => item.reviewStatus === "pending").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const moduleStats = MODULES.filter((mod) => mod.name !== "全模块测试").map((mod) => {
    const scoped = rows.filter((item) => item.module === mod.name);
    const scopedTotal = sum(scoped, "total");
    const scopedCorrect = sum(scoped, "correct");
    return {
      ...mod,
      total: scopedTotal,
      correct: scopedCorrect,
      rate: percent(scopedCorrect, scopedTotal),
      pace: avgPace(scoped),
      wrong: scopedTotal - scopedCorrect,
      pending: scoped.filter((item) => item.reviewStatus === "pending").length
    };
  });
  const weak = moduleStats.filter((item) => item.total > 0).sort((a, b) => a.rate - b.rate || b.wrong - a.wrong)[0];
  const slow = moduleStats.filter((item) => item.total > 0 && item.pace > 0).sort((a, b) => b.pace - a.pace)[0];
  const reasons = aggregateWrong(rows, (item) => item.errorReason).filter((item) => item.name !== "无").slice(0, 7);
  return {
    rows,
    total,
    correct,
    totalRate: percent(correct, total),
    todayTotal,
    todayRate: percent(sum(todayRows, "correct"), todayTotal),
    avgPace: avgPace(rows),
    pending,
    moduleStats,
    trend: makeTrend(rows, 14),
    heatmap: makeHeatmap(rows, 35),
    reasons,
    quote: quoteOfDay(),
    weak,
    slow,
    goalDone: Math.min(100, percent(todayTotal, settings.dailyGoal)),
    recommendations: recommendations({ total, todayTotal, pending, weak, reasons }, settings)
  };
}

export function moduleDetail(records: TrainingRecord[], module: ModuleName, settings: Settings, subType = "全部题型", range = "30") {
  let rows = active(records).filter((item) => item.module === module);
  const allModuleRows = rows;
  if (subType !== "全部题型") rows = rows.filter((item) => item.subType === subType);
  if (range !== "全部") rows = rows.filter((item) => item.date >= daysAgo(Number(range) - 1));
  const total = sum(rows, "total");
  const correct = sum(rows, "correct");
  const subTypes = aggregate(rows, (item) => item.subType)
    .map((item) => ({ ...item, rate: percent(item.correct, item.total), wrong: item.total - item.correct }))
    .sort((a, b) => a.rate - b.rate || b.wrong - a.wrong);
  const reasons = aggregateWrong(rows, (item) => item.errorReason).filter((item) => item.name !== "无").slice(0, 7);
  const pending = rows.filter((item) => item.reviewStatus === "pending").length;
  const pace = avgPace(rows);
  const actions = [
    total ? `${shortName(module)}累计 ${total} 题，正确率 ${percent(correct, total)}%。` : "这个模块还没有足够样本，先录入一组真实训练。",
    subTypes[0] ? `优先看 ${subTypes[0].name}，当前错题压力最高。` : "题型样本还不够，先按原小项补齐记录。",
    reasons[0] ? `高频错因是 ${reasons[0].name}，复盘时先处理同类问题。` : "错因结构暂时干净，继续保持记录。",
    pending ? `还有 ${pending} 条待复盘记录。` : "复盘队列已清空。",
    total && percent(correct, total) < settings.targetRate ? "正确率还没到目标，下一组建议降低题量做精复盘。" : "当前正确率接近或超过目标，可以增加限时压力。"
  ];
  return {
    rows,
    total,
    correct,
    rate: percent(correct, total),
    pace,
    wrong: total - correct,
    subTypes,
    reasons,
    pending,
    trend: makeTrend(rows, range === "全部" ? trendDaysFor(allModuleRows) : Number(range) || 30),
    actions,
    targetRate: settings.targetRate
  };
}

export function markReviewedRecord(record: TrainingRecord): TrainingRecord {
  return { ...record, reviewStatus: "reviewed", reviewedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

export function generateCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `xc-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function normalizeCode(value: string) {
  return value.trim().replace(/[^A-Za-z0-9-]/g, "").replace(/--+/g, "-").slice(0, 48);
}

export async function syncSpace(spaceCode: string, records: TrainingRecord[], settings: Settings, options: { upload?: boolean } = {}) {
  const code = normalizeCode(spaceCode);
  if (!code) return { records, settings };
  const shouldUpload = options.upload !== false;
  const hashes = await candidateHashes(code);
  let remoteRow: { payload: string; updated_at: string; space_hash: string } | null = null;
  for (const hash of hashes) {
    const rows = await cloudFetch<Array<{ payload: string; updated_at: string; space_hash: string }>>(
      `/rest/v1/xingce_sync?space_hash=eq.${encodeURIComponent(hash)}&select=payload,updated_at,space_hash&limit=1`
    );
    if (rows[0]) {
      remoteRow = rows[0];
      break;
    }
  }
  const remote = remoteRow ? await parsePayload(remoteRow.payload, code) : null;
  const mergedRecords = mergeRecords(records, remote?.records || []);
  const mergedSettings = mergeSettings(settings, remote?.settings);
  const targetHash = remoteRow?.space_hash || hashes[0];
  if (shouldUpload) {
    await cloudFetch(`/rest/v1/xingce_sync?on_conflict=space_hash`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        space_hash: targetHash,
        payload: await encryptText(JSON.stringify({ version: 6, records: mergedRecords, settings: mergedSettings, updatedAt: new Date().toISOString() }), code),
        updated_at: new Date().toISOString()
      })
    });
  }
  return { records: mergedRecords, settings: mergedSettings };
}

export function exportCsv(records: TrainingRecord[]) {
  const header = ["日期", "模块", "题型", "总题", "正确", "正确率", "耗时(分)", "配速(秒/题)", "配速状态", "错因", "标签", "备注"];
  return "\uFEFF" + [header, ...active(records).map((item) => [
    item.date,
    item.module,
    item.subType,
    item.total,
    item.correct,
    `${percent(item.correct, item.total)}%`,
    item.duration,
    paceSeconds(item),
    paceState(item),
    item.errorReason,
    item.tags.join(" "),
    item.note
  ])]
    .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

function normalizeRecord(raw: unknown): TrainingRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<TrainingRecord> & {
    sub?: string;
    reason?: string;
    error_reason?: string;
    sub_type?: string;
    review_status?: string;
    reviewed_at?: string | null;
    deleted_at?: string | null;
    created_at?: string;
    updated_at?: string;
    wrong?: number;
  };
  const module = normalizeModule(String(item.module || ""));
  if (!module) return null;
  const total = clamp(item.total, 0, 9999);
  let correct = clamp(item.correct, 0, total);
  if (!Number.isFinite(Number(item.correct)) && Number.isFinite(Number(item.wrong))) correct = Math.max(0, total - Number(item.wrong));
  const duration = Math.round((Number(item.duration) || 0) * 10) / 10;
  if (!total || correct > total) return null;
  const now = new Date().toISOString();
  const errorReason = normalizeReason(String(item.errorReason || item.error_reason || item.reason || "无"));
  const wrong = Math.max(0, total - correct);
  const reviewed = item.reviewStatus === "reviewed" || item.review_status === "reviewed";
  return {
    id: String(item.id || randomId()),
    date: validDate(String(item.date || ""), today()),
    module,
    subType: normalizeSubType(String(item.subType || item.sub_type || item.sub || ""), module),
    total,
    correct,
    duration,
    errorReason,
    tags: normalizeTags(item.tags),
    note: String(item.note || "").trim(),
    reviewStatus: reviewed || (wrong === 0 && errorReason === "无") ? "reviewed" : "pending",
    reviewedAt: item.reviewedAt || item.reviewed_at || null,
    createdAt: String(item.createdAt || item.created_at || now),
    updatedAt: String(item.updatedAt || item.updated_at || now),
    deletedAt: item.deletedAt || item.deleted_at || null
  };
}

function normalizeTemplates(input: unknown): QuickTemplate[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((raw) => {
      const item = raw as Partial<QuickTemplate>;
      const module = normalizeModule(String(item.module || ""));
      if (!module) return null;
      return {
        id: String(item.id || randomId()),
        name: String(item.name || `${shortName(module)}模板`).trim().slice(0, 24),
        module,
        subType: normalizeSubType(String(item.subType || ""), module),
        total: positiveNumber(item.total) || "",
        duration: positiveNumber(item.duration) || "",
        errorReason: normalizeReason(String(item.errorReason || "无")),
        tags: normalizeTags(item.tags).join(" ")
      };
    })
    .filter(Boolean)
    .slice(0, 24) as QuickTemplate[];
}

function mergeRecords(local: TrainingRecord[], remote: TrainingRecord[]) {
  return normalizeRecords([...local, ...remote]);
}

function mergeSettings(local: Settings, remote?: Partial<Settings> | null) {
  if (!remote) return normalizeSettings(local);
  const safeLocal = normalizeSettings(local);
  const safeRemote = normalizeSettings(remote);
  return safeRemote.updatedAt > safeLocal.updatedAt ? safeRemote : safeLocal;
}

async function parsePayload(payload: string, code: string) {
  const raw = String(payload || "").trim();
  const texts: string[] = [];
  if (raw.startsWith("{")) {
    texts.push(raw);
  } else {
    for (const salt of ["xingce-v20-cloud-sync", "xingce-space-sync-v4"]) {
      try {
        texts.push(await decryptText(raw, code, salt));
        break;
      } catch {
        continue;
      }
    }
  }
  for (const text of texts) {
    try {
      const parsed = JSON.parse(text);
      return { records: normalizeRecords(parsed.records || parsed), settings: normalizeSettings(parsed.settings || {}) };
    } catch {
      continue;
    }
  }
  return null;
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
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

const encoder = new TextEncoder();
const keyCache = new Map<string, CryptoKey>();

async function candidateHashes(code: string) {
  const variants = Array.from(new Set([code, code.toLowerCase(), code.toUpperCase()]));
  return Promise.all(variants.map(hashText));
}

async function deriveKey(code: string, salt: string) {
  const cacheKey = `${salt}:${code}`;
  const cached = keyCache.get(cacheKey);
  if (cached) return cached;
  const material = await crypto.subtle.importKey("raw", encoder.encode(code), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: encoder.encode(salt), iterations: 120_000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  keyCache.set(cacheKey, key);
  return key;
}

async function encryptText(text: string, code: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await deriveKey(code, "xingce-v20-cloud-sync"), encoder.encode(text)));
  return `${toBase64(iv)}.${toBase64(cipher)}`;
}

async function decryptText(payload: string, code: string, salt: string) {
  const [iv, cipher] = payload.split(".");
  if (!iv || !cipher) throw new Error("bad payload");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(iv) }, await deriveKey(code, salt), fromBase64(cipher));
  return new TextDecoder().decode(plain);
}

async function hashText(text: string) {
  const buffer = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function makeTrend(records: TrainingRecord[], days: number) {
  return Array.from({ length: days }, (_, index) => {
    const date = daysAgo(days - index - 1);
    const scoped = records.filter((item) => item.date === date);
    const total = sum(scoped, "total");
    return {
      date,
      label: date.slice(5),
      total,
      rate: total ? percent(sum(scoped, "correct"), total) : null,
      pace: total ? avgPace(scoped) : null
    };
  });
}

function trendDaysFor(records: TrainingRecord[]) {
  const dates = [...new Set(records.map((item) => item.date))].sort();
  if (!dates.length) return 30;
  const first = new Date(dates[0]);
  const last = new Date(dates[dates.length - 1]);
  const days = Math.round((last.getTime() - first.getTime()) / 86_400_000) + 1;
  return Math.max(30, Math.min(90, days));
}

function makeHeatmap(records: TrainingRecord[], days: number) {
  return Array.from({ length: days }, (_, index) => {
    const date = daysAgo(days - index - 1);
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

function recommendations(data: { total: number; todayTotal: number; pending: TrainingRecord[]; weak?: { short: string; rate: number }; reasons: Array<{ name: string; value: number }> }, settings: Settings) {
  if (!data.total) return ["先录入一组真实训练，不需要追求好看，样本比空白更重要。", "录入时保留题型、耗时和错因，后面诊断才会准。"];
  const list = [];
  if (data.pending.length) list.push(`复盘队列还有 ${data.pending.length} 条，先处理最近的错因。`);
  if (data.weak) list.push(`${data.weak.short} 当前正确率偏低，下一轮优先做小题量精练。`);
  if (data.reasons[0]) list.push(`${data.reasons[0].name} 是当前主要错因，建议单独建立一组复盘记录。`);
  if (data.todayTotal < settings.dailyGoal) list.push(`今日还差 ${Math.max(0, settings.dailyGoal - data.todayTotal)} 题，适合补一组短训练。`);
  return list.slice(0, 4);
}

function quoteOfDay() {
  const key = today();
  const seed = key.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return QUOTES[seed % QUOTES.length];
}

function active(records: TrainingRecord[]) {
  return normalizeRecords(records).filter((item) => !item.deletedAt);
}

function sum(records: TrainingRecord[], key: "total" | "correct" | "duration") {
  return records.reduce((acc, item) => acc + item[key], 0);
}

function daysAgo(offset: number) {
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

function normalizeModule(value: string): ModuleName | "" {
  const text = value.trim();
  const exact = MODULES.find((item) => item.name === text || item.short === text || item.id === text);
  if (exact) return exact.name;
  if (/言语|言语理解/.test(text)) return "言语理解与表达";
  if (/判断|推理/.test(text)) return "判断推理";
  if (/资料/.test(text)) return "资料分析";
  if (/数量|数学/.test(text)) return "数量关系";
  if (/常识|政治|法律|法治|宪法|行政法|刑法|民法|科技|人文|历史|地理|经济管理|管理常识|公文|时政/.test(text)) return "常识判断";
  if (/全测|全模块|全套|套卷|混合|混刷|综合/.test(text)) return "全模块测试";
  return "";
}

function normalizeSubType(value: string, module: ModuleName) {
  const text = value.trim();
  const options = moduleConfig(module)?.subTypes || [];
  if (!text || text === "综合") return options.includes("综合卷/混刷") ? "综合卷/混刷" : options[0] || "";
  if (options.includes(text)) return text;
  if (/综合|混刷|混合/.test(text) && options.includes("综合卷/混刷")) return "综合卷/混刷";
  if (/套|全/.test(text) && module === "全模块测试") return "全套模拟";
  return text;
}

function normalizeReason(value: string) {
  const text = value.trim();
  if (!text || text === "全对/常规" || text === "无错因/常规" || text === "常规") return "无";
  return ERROR_REASONS.includes(text) ? text : text.slice(0, 18);
}

function normalizeTags(value: unknown) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 8);
  return String(value || "")
    .split(/[、，,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function validDate(value: string, fallback: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number * 10) / 10 : 0;
}

function clamp(value: unknown, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function randomId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
