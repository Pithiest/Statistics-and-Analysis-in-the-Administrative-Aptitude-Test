import {
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Cloud,
  CloudOff,
  Download,
  Edit3,
  Flame,
  Gauge,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Moon,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Sun,
  Table2,
  Target,
  TimerReset,
  Trash2,
  Upload,
  Wand2
} from "lucide-react";
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  DEFAULT_FORM,
  DEFAULT_SETTINGS,
  ERROR_REASONS,
  MODULES,
  accent,
  avgPace,
  createRecord,
  dashboard,
  exportCsv,
  firstSubType,
  formFromTemplate,
  generateCode,
  loadState,
  markReviewedRecord,
  moduleDetail,
  moduleSubTypes,
  normalizeCode,
  normalizeRecords,
  normalizeSettings,
  paceSeconds,
  paceState,
  paceText,
  percent,
  saveRecords,
  saveSettings,
  saveSpaceCode,
  shortName,
  stampSettings,
  subTypeOptions,
  suggestedMinutes,
  syncSpace,
  templateFromForm,
  today
} from "./model";
import type { EntryForm, ModuleName, QuickTemplate, Settings, SyncState, TrainingRecord, ViewId } from "./model";

const nav: Array<{ id: ViewId; label: string; icon: ReactNode }> = [
  { id: "today", label: "总览", icon: <LayoutDashboard /> },
  { id: "record", label: "录入", icon: <Plus /> },
  { id: "diagnosis", label: "诊断", icon: <BarChart3 /> },
  { id: "review", label: "复盘", icon: <ListChecks /> },
  { id: "ledger", label: "台账", icon: <Table2 /> },
  { id: "settings", label: "设置", icon: <KeyRound /> }
];

const SYNC_DEBOUNCE_MS = 10_000;
const PULL_INTERVAL_MS = 120_000;
const OverviewTrendChart = lazy(() => import("./Charts").then((module) => ({ default: module.OverviewTrendChart })));
const ModuleRadarChart = lazy(() => import("./Charts").then((module) => ({ default: module.ModuleRadarChart })));
const ModuleTrendChart = lazy(() => import("./Charts").then((module) => ({ default: module.ModuleTrendChart })));
const SubTypeBarChart = lazy(() => import("./Charts").then((module) => ({ default: module.SubTypeBarChart })));

export function App() {
  const loaded = useMemo(loadState, []);
  const [view, setView] = useState<ViewId>("today");
  const [records, setRecords] = useState<TrainingRecord[]>(loaded.records);
  const [settings, setSettings] = useState<Settings>(loaded.settings);
  const [spaceCode, setSpaceCode] = useState(loaded.spaceCode);
  const [syncState, setSyncState] = useState<SyncState>(loaded.spaceCode ? "syncing" : "local");
  const [lastSync, setLastSync] = useState("");
  const [toast, setToast] = useState("");
  const [form, setForm] = useState<EntryForm>({ ...DEFAULT_FORM, date: today() });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [timer, setTimer] = useState(0);
  const [timerOn, setTimerOn] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [ledgerQuery, setLedgerQuery] = useState("");
  const [ledgerModule, setLedgerModule] = useState<ModuleName | "全部模块">("全部模块");
  const [ledgerReason, setLedgerReason] = useState<string>("全部错因");
  const [ledgerSort, setLedgerSort] = useState("date-desc");
  const [diagnosisModule, setDiagnosisModule] = useState<ModuleName>("言语理解与表达");
  const [diagnosisSub, setDiagnosisSub] = useState("全部题型");
  const [diagnosisRange, setDiagnosisRange] = useState("全部");
  const recordsRef = useRef(records);
  const settingsRef = useRef(settings);
  const codeRef = useRef(spaceCode);
  const syncingRef = useRef(false);
  const dirtyRef = useRef(false);
  const lastPullRef = useRef(0);
  const changeVersionRef = useRef(0);
  const debounceRef = useRef<number>();

  const data = useMemo(() => dashboard(records, settings), [records, settings]);
  const currentRecord = editingId ? records.find((item) => item.id === editingId) : undefined;

  useEffect(() => {
    recordsRef.current = records;
    saveRecords(records);
  }, [records]);

  useEffect(() => {
    settingsRef.current = settings;
    saveSettings(settings);
    document.documentElement.dataset.theme = settings.theme;
  }, [settings]);

  useEffect(() => {
    codeRef.current = spaceCode;
    saveSpaceCode(spaceCode);
  }, [spaceCode]);

  useEffect(() => {
    if (!spaceCode) return undefined;
    void pullIfDue(true);
    const runBackgroundSync = () => {
      if (dirtyRef.current) void syncNow({ upload: true });
      else void pullIfDue(false);
    };
    const interval = window.setInterval(runBackgroundSync, PULL_INTERVAL_MS);
    const focus = runBackgroundSync;
    window.addEventListener("focus", focus);
    window.addEventListener("online", focus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", focus);
      window.removeEventListener("online", focus);
    };
  }, [spaceCode]);

  useEffect(() => {
    if (!timerOn) return undefined;
    const id = window.setInterval(() => setTimer((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [timerOn]);

  useEffect(() => {
    const loadCharts = () => {
      void import("./Charts");
    };
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(loadCharts, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = globalThis.setTimeout(loadCharts, 2500);
    return () => globalThis.clearTimeout(id);
  }, []);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }

  function navigate(next: ViewId) {
    if (next === view) return;
    const update = () => setView(next);
    const doc = document as Document & { startViewTransition?: (callback: () => void) => void };
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches && doc.startViewTransition) {
      doc.startViewTransition(update);
      return;
    }
    update();
  }

  function scheduleSync() {
    changeVersionRef.current += 1;
    dirtyRef.current = true;
    if (!codeRef.current) {
      setSyncState("local");
      return;
    }
    if (!navigator.onLine) {
      setSyncState("offline");
      return;
    }
    window.clearTimeout(debounceRef.current);
    setSyncState("pending");
    debounceRef.current = window.setTimeout(() => void syncNow({ upload: true }), SYNC_DEBOUNCE_MS);
  }

  function pullIfDue(force = false) {
    const now = Date.now();
    if (!force && now - lastPullRef.current < PULL_INTERVAL_MS) return;
    lastPullRef.current = now;
    void syncNow({ upload: false, quiet: !force });
  }

  async function syncNow(options: { upload?: boolean; quiet?: boolean } = {}) {
    const code = normalizeCode(codeRef.current);
    if (!code) return;
    if (syncingRef.current) {
      if (options.upload) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = window.setTimeout(() => void syncNow({ upload: true }), 2_000);
      }
      return;
    }
    if (!navigator.onLine) {
      setSyncState("offline");
      return;
    }
    const upload = options.upload !== false;
    const uploadVersion = changeVersionRef.current;
    syncingRef.current = true;
    if (!options.quiet) setSyncState("syncing");
    try {
      const next = await syncSpace(code, recordsRef.current, settingsRef.current, { upload });
      const mergedRecords = normalizeRecords([...next.records, ...recordsRef.current]);
      const nextSettings = normalizeSettings(next.settings);
      const currentSettings = normalizeSettings(settingsRef.current);
      const mergedSettings = nextSettings.updatedAt > currentSettings.updatedAt ? nextSettings : currentSettings;
      if (!sameRecordList(recordsRef.current, mergedRecords)) setRecords(mergedRecords);
      if (mergedSettings.updatedAt !== currentSettings.updatedAt) setSettings(mergedSettings);
      setLastSync(new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }));
      if (upload && changeVersionRef.current === uploadVersion) dirtyRef.current = false;
      setSyncState(dirtyRef.current ? "pending" : "synced");
    } catch (error) {
      console.error(error);
      setSyncState("error");
      notify("同步失败，已保留本机数据，稍后会继续尝试。");
    } finally {
      syncingRef.current = false;
    }
  }

  function updateSettings(next: Settings, shouldSync = true) {
    setSettings(stampSettings(next));
    if (shouldSync) scheduleSync();
  }

  function submit(continueInput = false) {
    const previous = currentRecord;
    const nextRecord = createRecord(form, previous);
    if (!nextRecord) {
      notify("请检查模块、题型、题量、正确数和用时。");
      return;
    }
    setRecords((list) => (previous ? list.map((item) => (item.id === previous.id ? nextRecord : item)) : [nextRecord, ...list]));
    setEditingId(null);
    setTimer(0);
    setTimerOn(false);
    setForm((old) => {
      if (continueInput && !previous) {
        return { ...old, correct: "", errorReason: "无", note: "", tags: "", date: old.date || today() };
      }
      return { ...DEFAULT_FORM, date: today() };
    });
    scheduleSync();
    notify(spaceCode ? "已保存，后台会自动同步。" : "已保存到本机。");
  }

  function edit(record: TrainingRecord) {
    setEditingId(record.id);
    setForm({
      date: record.date,
      module: record.module,
      subType: record.subType,
      total: String(record.total),
      correct: String(record.correct),
      duration: String(record.duration),
      errorReason: record.errorReason,
      tags: record.tags.join(" "),
      note: record.note
    });
    navigate("record");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function softDelete(record: TrainingRecord) {
    const now = new Date().toISOString();
    setRecords((list) => list.map((item) => (item.id === record.id ? { ...item, deletedAt: now, updatedAt: now } : item)));
    scheduleSync();
    notify("记录已删除。");
  }

  function markReviewed(record: TrainingRecord) {
    setRecords((list) => list.map((item) => (item.id === record.id ? markReviewedRecord(item) : item)));
    scheduleSync();
  }

  function addTemplate() {
    const template = templateFromForm(form, templateName);
    if (!template) {
      notify("先选择模块和题型，再保存快捷模板。");
      return;
    }
    updateSettings({ ...settings, quickTemplates: [template, ...settings.quickTemplates].slice(0, 24) });
    setTemplateName("");
    notify("快捷模板已保存。");
  }

  function applyTemplate(template: QuickTemplate) {
    setForm((old) => formFromTemplate(old, template));
    notify("已填入模板内容。");
  }

  function deleteTemplate(template: QuickTemplate) {
    updateSettings({ ...settings, quickTemplates: settings.quickTemplates.filter((item) => item.id !== template.id) });
  }

  function importBackup(file?: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || "{}"));
        const imported = normalizeRecords(Array.isArray(parsed) ? parsed : parsed.records);
        const hasSettings = Boolean(parsed.settings && typeof parsed.settings === "object");
        if (!imported.length && !hasSettings) throw new Error("empty");
        if (imported.length) setRecords((list) => normalizeRecords([...imported, ...list]));
        if (hasSettings) setSettings(stampSettings(normalizeSettings({ ...settingsRef.current, ...parsed.settings })));
        scheduleSync();
        notify(imported.length ? `已导入 ${imported.length} 条记录。` : "已导入设置。");
      } catch (error) {
        console.error(error);
        notify("导入失败，请检查 JSON 备份文件。");
      }
    };
    reader.readAsText(file, "utf-8");
  }

  function download(name: string, content: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  }

  function fillDurationFromTimer() {
    if (!timer) {
      notify("先开始计时，再填入用时。");
      return;
    }
    setForm((old) => ({ ...old, duration: String(Math.max(1, Math.ceil(timer / 60))) }));
    notify("已把计时结果填入用时。");
  }

  const ledger = useMemo(() => {
    const query = ledgerQuery.trim().toLowerCase();
    const rows = data.rows.filter((item) => {
      const text = `${item.date} ${item.module} ${item.subType} ${item.errorReason} ${item.tags.join(" ")} ${item.note}`.toLowerCase();
      return (
        (ledgerModule === "全部模块" || item.module === ledgerModule) &&
        (ledgerReason === "全部错因" || item.errorReason === ledgerReason) &&
        (!query || text.includes(query))
      );
    });
    return rows.slice().sort((a, b) => {
      if (ledgerSort === "rate-asc") return percent(a.correct, a.total) - percent(b.correct, b.total);
      if (ledgerSort === "rate-desc") return percent(b.correct, b.total) - percent(a.correct, a.total);
      if (ledgerSort === "pace-slow") return paceSeconds(b) - paceSeconds(a);
      if (ledgerSort === "pace-fast") return paceSeconds(a) - paceSeconds(b);
      return b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [data.rows, ledgerModule, ledgerQuery, ledgerReason, ledgerSort]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/pithiest-icon.svg" alt="" />
          <div>
            <strong>行测数据舱</strong>
            <span>记录 · 诊断 · 复盘</span>
          </div>
        </div>
        <nav className="side-nav">
          {nav.map((item) => (
            <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => navigate(item.id)}>
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sync-card">
            <SyncIcon state={syncState} />
            <div>
              <strong>{syncLabel(syncState)}</strong>
              <span>{syncHint(syncState, spaceCode, lastSync)}</span>
            </div>
          </div>
          <span className="creator-mark">Pithiest巨献</span>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p>行测训练统计</p>
            <h1>{title(view)}</h1>
          </div>
          <div className="top-actions">
            <button className="icon-btn" onClick={() => updateSettings({ ...settings, theme: settings.theme === "dark" ? "light" : "dark" }, false)} title="切换主题">
              {settings.theme === "dark" ? <Sun /> : <Moon />}
            </button>
            <button className="soft-btn" onClick={() => navigate("settings")}>
              <KeyRound /> 空间码
            </button>
            <button className="primary-btn" onClick={() => navigate("record")}>
              <Plus /> 录入
            </button>
          </div>
        </header>

        <section key={view} className="page">
            {view === "today" && <Today data={data} settings={settings} onRecord={() => navigate("record")} onReview={() => navigate("review")} />}
            {view === "record" && (
              <RecordView
                form={form}
                setForm={setForm}
                templates={settings.quickTemplates}
                templateName={templateName}
                onTemplateName={setTemplateName}
                editing={Boolean(editingId)}
                timer={timer}
                timerOn={timerOn}
                onTimer={() => setTimerOn((value) => !value)}
                onResetTimer={() => {
                  setTimer(0);
                  setTimerOn(false);
                }}
                onUseTimer={fillDurationFromTimer}
                onAddTemplate={addTemplate}
                onApplyTemplate={applyTemplate}
                onDeleteTemplate={deleteTemplate}
                onSave={() => submit(false)}
                onSaveContinue={() => submit(true)}
              />
            )}
            {view === "diagnosis" && (
              <Diagnosis
                records={records}
                settings={settings}
                module={diagnosisModule}
                subType={diagnosisSub}
                range={diagnosisRange}
                setModule={(next) => {
                  setDiagnosisModule(next);
                  setDiagnosisSub("全部题型");
                }}
                setSubType={setDiagnosisSub}
                setRange={setDiagnosisRange}
                onEdit={edit}
              />
            )}
            {view === "review" && <Review records={data.pending} onDone={markReviewed} onEdit={edit} onDelete={softDelete} />}
            {view === "ledger" && (
              <Ledger
                records={ledger}
                query={ledgerQuery}
                module={ledgerModule}
                reason={ledgerReason}
                sort={ledgerSort}
                onQuery={setLedgerQuery}
                onModule={setLedgerModule}
                onReason={setLedgerReason}
                onSort={setLedgerSort}
                onEdit={edit}
                onDelete={softDelete}
              />
            )}
            {view === "settings" && (
              <SettingsView
                settings={settings}
                setSettings={updateSettings}
                spaceCode={spaceCode}
                setSpaceCode={(code) => {
                  const normalized = normalizeCode(code);
                  codeRef.current = normalized;
                  setSpaceCode(normalized);
                  setSyncState(normalized ? "syncing" : "local");
                  if (normalized) window.setTimeout(() => void syncNow({ upload: true }), 0);
                }}
                syncState={syncState}
                lastSync={lastSync}
                onGenerate={() => {
                  const code = generateCode();
                  codeRef.current = code;
                  setSpaceCode(code);
                  scheduleSync();
                  notify("空间码已生成。");
                }}
                onSync={() => void syncNow({ upload: true })}
                onClear={() => {
                  window.clearTimeout(debounceRef.current);
                  dirtyRef.current = false;
                  codeRef.current = "";
                  setSpaceCode("");
                  setSyncState("local");
                  setLastSync("");
                }}
                onExportJson={() => download(`xingce-backup-${today()}.json`, JSON.stringify({ version: 7, records, settings }, null, 2), "application/json;charset=utf-8")}
                onExportCsv={() => download(`xingce-ledger-${today()}.csv`, exportCsv(data.rows), "text/csv;charset=utf-8")}
                onImport={importBackup}
              />
            )}
        </section>
      </main>

      <nav className="mobile-nav">
        {nav.map((item) => (
          <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => navigate(item.id)}>
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function Today({ data, settings, onRecord, onReview }: { data: ReturnType<typeof dashboard>; settings: Settings; onRecord: () => void; onReview: () => void }) {
  const radarData = data.moduleStats.map((item) => ({ module: item.short, 正确率: item.rate || 0, 样本: item.total }));
  const remaining = Math.max(0, settings.dailyGoal - data.todayTotal);
  const rateGap = data.todayTotal ? Math.max(0, settings.targetRate - data.todayRate) : 0;
  const heroTitle = !data.total
    ? "先建立第一条训练记录"
    : remaining
      ? `今天还差 ${remaining} 题`
      : "今日题量已达标";
  const heroDetail = !data.total
    ? "录入一组真实训练后，系统会开始判断题量、正确率、错因和配速。"
    : rateGap
      ? `今日正确率 ${data.todayRate}%，距离目标还差 ${rateGap} 个点。`
      : `今日正确率 ${data.todayRate}%，继续保持复盘节奏。`;
  return (
    <div className="stack">
      <section className="hero">
        <div className="hero-copy">
          <h2>{heroTitle}</h2>
          <span>{heroDetail}</span>
          <p className="quote-line">{data.quote}</p>
          <div className="hero-actions">
            <button className="primary-btn" onClick={onRecord}><Plus /> 录入训练</button>
            <button className="soft-btn" onClick={onReview}><ListChecks /> 处理复盘</button>
          </div>
        </div>
        <div className="goal-card">
          <span>今日目标</span>
          <strong>{data.goalDone}%</strong>
          <small>{data.todayTotal}/{settings.dailyGoal} 题</small>
          <i style={{ width: `${data.goalDone}%` }} />
        </div>
      </section>

      <section className="focus-strip">
        <div>
          <span>近 7 天</span>
          <strong>{data.weekTotal}</strong>
          <small>{data.weekRate ? `${data.weekRate}% 正确率` : "暂无样本"}</small>
        </div>
        <div>
          <span>连续训练</span>
          <strong>{data.streak}</strong>
          <small>累计活跃 {data.activeDays} 天</small>
        </div>
        <div>
          <span>当前弱项</span>
          <strong>{data.weak?.short || "--"}</strong>
          <small>{data.weak ? `${data.weak.rate}% · ${data.weak.total}题` : "等待数据"}</small>
        </div>
        <div>
          <span>复盘压力</span>
          <strong>{data.pending.length}</strong>
          <small>{data.pending.length ? "先处理最近错因" : "队列清爽"}</small>
        </div>
      </section>

      <section className="metric-grid">
        <Metric label="累计正确率" value={`${data.totalRate}%`} unit={`${data.correct}/${data.total || 0} 题`} icon={<Target />} />
        <Metric label="今日题量" value={data.todayTotal} unit={`目标 ${settings.dailyGoal} 题`} icon={<Flame />} />
        <Metric label="平均配速" value={data.avgPace || "--"} unit="秒/题" icon={<Gauge />} />
        <Metric label="最慢模块" value={data.slow?.short || "--"} unit={data.slow?.pace ? `${data.slow.pace}s/题` : "暂无样本"} icon={<Clock3 />} />
      </section>

      <section className="grid-two wide-left">
        <Panel title="14 天趋势" note="题量 / 正确率 / 配速">
          <ChartBox>
            <DeferredChart>
              <OverviewTrendChart data={data.trend} targetRate={settings.targetRate} />
            </DeferredChart>
          </ChartBox>
        </Panel>
        <Panel title="模块能力矩阵" note="按原模块统计">
          {data.total ? (
            <ChartBox>
              <DeferredChart>
                <ModuleRadarChart data={radarData} />
              </DeferredChart>
            </ChartBox>
          ) : <Empty text="录入后生成模块矩阵。" />}
          <div className="matrix-note">
            {data.moduleStats.map((item) => <span key={item.id}>{item.short} {item.total}题</span>)}
          </div>
        </Panel>
      </section>

      <section className="grid-two">
        <Panel title="错因结构" note="按错题数汇总">
          {data.reasons.length ? (
            <Bars rows={data.reasons.map((item) => ({ name: item.name, value: item.value, hint: `${item.value}错` }))} empty="暂无错因数据" />
          ) : <Empty text="暂无错因数据。" />}
        </Panel>
        <Panel title="训练热力" note="近 35 天题量">
          <div className="heatmap">
            {data.heatmap.map((item) => <span key={item.date} data-level={item.level} title={`${item.date} · ${item.total} 题`} />)}
          </div>
          <ul className="advice compact-list">{data.recommendations.map((item) => <li key={item}>{item}</li>)}</ul>
        </Panel>
      </section>

      <Panel title="模块概况">
        <div className="module-list">
          {data.moduleStats.map((item) => (
            <div key={item.id}>
              <span style={{ color: item.accent }}>{item.name}</span>
              <strong>{item.total ? `${item.rate}%` : "--"}</strong>
              <i><b style={{ width: `${item.rate}%`, background: item.accent }} /></i>
              <small>{item.total} 题 · {item.pace ? `${item.pace}s/题` : "--"}</small>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function RecordView(props: {
  form: EntryForm;
  setForm: (next: EntryForm) => void;
  templates: QuickTemplate[];
  templateName: string;
  onTemplateName: (value: string) => void;
  editing: boolean;
  timer: number;
  timerOn: boolean;
  onTimer: () => void;
  onResetTimer: () => void;
  onUseTimer: () => void;
  onAddTemplate: () => void;
  onApplyTemplate: (template: QuickTemplate) => void;
  onDeleteTemplate: (template: QuickTemplate) => void;
  onSave: () => void;
  onSaveContinue: () => void;
}) {
  const { form, setForm } = props;
  const setModule = (module: ModuleName | "") => setForm({ ...form, module, subType: "" });
  const setTotal = (total: string) => setForm({ ...form, total });
  const useSuggested = () => {
    const value = suggestedMinutes(form.module, form.total);
    if (value) setForm({ ...form, duration: value });
  };
  return (
    <div className="stack">
      <section className="form-layout">
        <Panel title={props.editing ? "编辑训练" : "录入训练"} note="表单默认保持空白，模板由你自己保存">
          <div className="form-grid">
            <Field label="日期"><input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></Field>
            <Field label="模块">
              <select value={form.module} onChange={(event) => setModule(event.target.value as ModuleName | "")}>
                <option value="">选择模块</option>
                {MODULES.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
              </select>
            </Field>
            <Field label="题型">
              <select value={form.subType} disabled={!form.module} onChange={(event) => setForm({ ...form, subType: event.target.value })}>
                <option value="">{form.module ? "选择题型" : "先选模块"}</option>
                {subTypeOptions(form.module, form.subType).map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </Field>
            <Field label="题量"><input inputMode="numeric" value={form.total} onChange={(event) => setTotal(event.target.value)} placeholder="完成题数" /></Field>
            <Field label="正确数"><input inputMode="numeric" value={form.correct} onChange={(event) => setForm({ ...form, correct: event.target.value })} placeholder="做对几题" /></Field>
            <Field label="用时">
              <div className="input-action">
                <input inputMode="decimal" value={form.duration} onChange={(event) => setForm({ ...form, duration: event.target.value })} placeholder="分钟" />
                <button type="button" className="mini-btn" onClick={useSuggested}>估</button>
              </div>
            </Field>
            <Field label="主要错因">
              <select value={form.errorReason} onChange={(event) => setForm({ ...form, errorReason: event.target.value })}>
                {ERROR_REASONS.map((item) => <option key={item} value={item}>{item === "无" ? "无错因/常规" : item}</option>)}
              </select>
            </Field>
            <Field label="标签"><input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder="可选，用空格分隔" /></Field>
          </div>
          <Field label="备注"><textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="记录这组题暴露的问题" /></Field>
          <div className="button-row">
            <button className="primary-btn" onClick={props.onSave}><Save /> 保存</button>
            <button className="soft-btn" onClick={props.onSaveContinue}><Plus /> 保存并继续</button>
          </div>
        </Panel>

        <div className="side-stack">
          <Panel title="训练计时" note="正计时，结束后可填入用时">
            <div className="timer">
              <strong>{formatTimer(props.timer)}</strong>
              <div className="button-row">
                <button className="primary-btn" onClick={props.onTimer}>{props.timerOn ? <Pause /> : <Play />}{props.timerOn ? "暂停" : "开始"}</button>
                <button className="soft-btn" onClick={props.onResetTimer}><TimerReset /> 重置</button>
                <button className="soft-btn" onClick={props.onUseTimer}><Clock3 /> 填入用时</button>
              </div>
            </div>
          </Panel>
          <Panel title="快捷模板" note="只保存你自己常用的组合">
            <div className="template-maker">
              <input value={props.templateName} onChange={(event) => props.onTemplateName(event.target.value)} placeholder="模板名称，可不填" />
              <button className="soft-btn" onClick={props.onAddTemplate}><Wand2 /> 保存模板</button>
            </div>
            <div className="template-list">
              {props.templates.map((template) => (
                <article key={template.id} className="template-card">
                  <button type="button" onClick={() => props.onApplyTemplate(template)}>
                    <strong>{template.name}</strong>
                    <span>{template.module} · {template.subType}</span>
                  </button>
                  <button className="icon-btn danger" onClick={() => props.onDeleteTemplate(template)} title="删除模板"><Trash2 /></button>
                </article>
              ))}
              {!props.templates.length && <Empty text="填好一次常用组合后，在这里保存为模板。" />}
            </div>
          </Panel>
        </div>
      </section>
    </div>
  );
}

function Diagnosis({ records, settings, module, subType, range, setModule, setSubType, setRange, onEdit }: {
  records: TrainingRecord[];
  settings: Settings;
  module: ModuleName;
  subType: string;
  range: string;
  setModule: (module: ModuleName) => void;
  setSubType: (subType: string) => void;
  setRange: (range: string) => void;
  onEdit: (record: TrainingRecord) => void;
}) {
  const modules = MODULES.filter((item) => item.name !== "全模块测试");
  const detail = moduleDetail(records, module, settings, subType, range);
  const moduleAll = moduleDetail(records, module, settings, "全部题型", "全部");
  const allSubTypes = moduleSubTypes(records, module);
  const weakest = moduleAll.subTypes[0];
  const emptyText = moduleAll.total ? "当前时间范围暂无记录，模块全量摘要仍会保留在上方。" : "当前模块暂无记录。";
  return (
    <div className="stack">
      <div className="module-tabs">
        {modules.map((item) => {
          const quick = moduleDetail(records, item.name, settings, "全部题型", "全部");
          return (
            <button key={item.id} className={module === item.name ? "active" : ""} onClick={() => setModule(item.name)}>
              {item.short}
              <span>{quick.total ? `${quick.rate}% · ${quick.total}题` : "--"}</span>
            </button>
          );
        })}
      </div>

      <section className="toolbar diagnosis-toolbar">
        <select value={subType} onChange={(event) => setSubType(event.target.value)}>
          <option>全部题型</option>
          {allSubTypes.map((item) => <option key={item}>{item}</option>)}
        </select>
        <select value={range} onChange={(event) => setRange(event.target.value)}>
          <option value="7">近 7 天</option>
          <option value="14">近 14 天</option>
          <option value="30">近 30 天</option>
          <option value="90">近 90 天</option>
          <option value="全部">全部</option>
        </select>
      </section>

      <section className="diagnosis-action">
        <div>
          <span>下一步动作</span>
          <strong>{weakest ? `优先复盘 ${weakest.name}` : "先补一组真实样本"}</strong>
          <p>{detail.actions[2] || detail.actions[0]}</p>
        </div>
        <div className="button-row">
          {weakest && <button className="soft-btn" onClick={() => setSubType(weakest.name)}><Target /> 聚焦小项</button>}
        </div>
      </section>

      <section className="diagnosis-summary">
        <div>
          <span>模块总样本</span>
          <strong>{moduleAll.total}</strong>
          <small>{moduleAll.total ? `${moduleAll.rate}% · ${moduleAll.pace ? `${moduleAll.pace}s/题` : "--"}` : "暂无记录"}</small>
        </div>
        <div>
          <span>当前筛选</span>
          <strong>{detail.total}</strong>
          <small>{range === "全部" ? "全部时间" : `近 ${range} 天`} · {subType}</small>
        </div>
        <div>
          <span>优先小项</span>
          <strong>{weakest ? weakest.name : "--"}</strong>
          <small>{weakest ? `${weakest.rate}% · ${weakest.total}题` : "样本不足"}</small>
        </div>
      </section>

      <section className="metric-grid">
        <Metric label="筛选题量" value={detail.total} unit="题" icon={<CalendarDays />} />
        <Metric label="正确率" value={`${detail.rate}%`} unit={`目标 ${settings.targetRate}%`} icon={<Target />} />
        <Metric label="平均配速" value={detail.pace || "--"} unit="秒/题" icon={<Gauge />} />
        <Metric label="待复盘" value={detail.pending} unit="条" icon={<ListChecks />} />
      </section>

      <section className="grid-two wide-left">
        <Panel title={`${module} 趋势`} note="正确率与配速">
          {detail.total ? (
            <ChartBox>
              <DeferredChart>
                <ModuleTrendChart data={detail.trend} targetRate={settings.targetRate} />
              </DeferredChart>
            </ChartBox>
          ) : <Empty text={emptyText} />}
        </Panel>
        <Panel title="错因拆解" note="按错题数">
          {detail.reasons.length ? (
            <Bars rows={detail.reasons.map((item) => ({ name: item.name, value: item.value }))} empty="暂无错因数据" />
          ) : <Empty text="暂无错因数据。" />}
        </Panel>
      </section>

      <section className="grid-two">
        <Panel title="题型对比" note="按正确率从低到高">
          {detail.subTypes.length ? (
            <ChartBox>
              <DeferredChart>
                <SubTypeBarChart data={detail.subTypes} />
              </DeferredChart>
            </ChartBox>
          ) : <Empty text="暂无题型数据。" />}
        </Panel>
        <Panel title="诊断建议">
          <ul className="advice">{detail.actions.map((item) => <li key={item}>{item}</li>)}</ul>
        </Panel>
      </section>

      <Panel title="最近记录">
        <div className="record-list compact">
          {detail.rows.slice(0, 6).map((item) => <RecordCard key={item.id} record={item} onEdit={onEdit} />)}
          {!detail.rows.length && <Empty text={emptyText} />}
        </div>
      </Panel>
    </div>
  );
}

function Review({ records, onDone, onEdit, onDelete }: { records: TrainingRecord[]; onDone: (record: TrainingRecord) => void; onEdit: (record: TrainingRecord) => void; onDelete: (record: TrainingRecord) => void }) {
  return (
    <Panel title="复盘队列" note="错题和带错因的记录会进入这里">
      <div className="record-list">
        {records.map((item) => (
          <RecordCard
            key={item.id}
            record={item}
            onEdit={onEdit}
            onDelete={onDelete}
            action={<button className="primary-btn" onClick={() => onDone(item)}><CheckCircle2 /> 完成复盘</button>}
          />
        ))}
        {!records.length && <Empty text="当前没有待复盘记录。" />}
      </div>
    </Panel>
  );
}

function Ledger({ records, query, module, reason, sort, onQuery, onModule, onReason, onSort, onEdit, onDelete }: {
  records: TrainingRecord[];
  query: string;
  module: ModuleName | "全部模块";
  reason: string;
  sort: string;
  onQuery: (value: string) => void;
  onModule: (value: ModuleName | "全部模块") => void;
  onReason: (value: string) => void;
  onSort: (value: string) => void;
  onEdit: (record: TrainingRecord) => void;
  onDelete: (record: TrainingRecord) => void;
}) {
  const total = records.reduce((acc, item) => acc + item.total, 0);
  const correct = records.reduce((acc, item) => acc + item.correct, 0);
  const wrong = Math.max(0, total - correct);
  const pace = avgPace(records);
  const activeDayCount = new Set(records.map((item) => item.date)).size;
  const pending = records.filter((item) => item.reviewStatus === "pending").length;
  const hasFilter = Boolean(query || module !== "全部模块" || reason !== "全部错因" || sort !== "date-desc");
  const clearFilters = () => {
    onQuery("");
    onModule("全部模块");
    onReason("全部错因");
    onSort("date-desc");
  };
  return (
    <div className="stack">
      <section className="toolbar ledger-toolbar">
        <div className="search">
          <Search />
          <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="搜索日期、模块、题型、错因、标签、备注" />
        </div>
        <select value={module} onChange={(event) => onModule(event.target.value as ModuleName | "全部模块")}>
          <option>全部模块</option>
          {MODULES.map((item) => <option key={item.id}>{item.name}</option>)}
        </select>
        <select value={reason} onChange={(event) => onReason(event.target.value)}>
          <option>全部错因</option>
          {ERROR_REASONS.map((item) => <option key={item}>{item}</option>)}
        </select>
        <select value={sort} onChange={(event) => onSort(event.target.value)}>
          <option value="date-desc">最近优先</option>
          <option value="rate-asc">正确率低到高</option>
          <option value="rate-desc">正确率高到低</option>
          <option value="pace-slow">配速慢到快</option>
          <option value="pace-fast">配速快到慢</option>
        </select>
        <button className="soft-btn" onClick={clearFilters} disabled={!hasFilter}>清除筛选</button>
      </section>
      <section className="ledger-summary">
        <div><span>筛选题量</span><strong>{total}</strong><small>{records.length} 条记录</small></div>
        <div><span>筛选正确率</span><strong>{percent(correct, total)}%</strong><small>错 {wrong} 题</small></div>
        <div><span>平均配速</span><strong>{pace || "--"}</strong><small>秒/题</small></div>
        <div><span>复盘状态</span><strong>{pending}</strong><small>{activeDayCount} 个训练日</small></div>
      </section>
      <Panel title={`训练台账 · ${records.length} 条`} note="按筛选条件查看训练明细">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>日期</th>
                <th>模块/题型</th>
                <th>结果</th>
                <th>用时/配速</th>
                <th>错因</th>
                <th>备注</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {records.map((item) => (
                <tr key={item.id}>
                  <td>{item.date}</td>
                  <td><strong>{item.module}</strong><small>{item.subType}</small></td>
                  <td><strong>{percent(item.correct, item.total)}%</strong><small>{item.correct}/{item.total}</small></td>
                  <td><strong>{item.duration} 分</strong><small>{paceText(item)} · {paceState(item)}</small></td>
                  <td>{item.errorReason}</td>
                  <td><small>{[item.tags.join(" "), item.note].filter(Boolean).join(" · ") || "--"}</small></td>
                  <td><button className="icon-btn" onClick={() => onEdit(item)}><Edit3 /></button><button className="icon-btn danger" onClick={() => onDelete(item)}><Trash2 /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!records.length && <Empty text="没有符合条件的记录。" />}
        </div>
        <div className="mobile-ledger">
          {records.map((item) => (
            <article className="ledger-card" key={item.id}>
              <div>
                <span>{item.date}</span>
                <strong>{item.module}</strong>
                <small>{item.subType}</small>
              </div>
              <div className="ledger-stats">
                <b>{percent(item.correct, item.total)}%</b>
                <span>{item.correct}/{item.total}</span>
                <span>{Math.max(0, item.total - item.correct)} 错</span>
                <span>{paceText(item)}</span>
              </div>
              <p>{item.errorReason} · {paceState(item)}{item.reviewStatus === "pending" ? " · 待复盘" : ""}</p>
              {(item.tags.length > 0 || item.note) && <small className="ledger-card-meta">{[item.tags.join(" / "), item.note].filter(Boolean).join(" · ")}</small>}
              <div className="card-actions">
                <button className="soft-btn" onClick={() => onEdit(item)}><Edit3 /> 编辑</button>
                <button className="soft-btn danger-text" onClick={() => onDelete(item)}><Trash2 /> 删除</button>
              </div>
            </article>
          ))}
          {!records.length && <Empty text="没有符合条件的记录。" />}
        </div>
      </Panel>
    </div>
  );
}

function SettingsView({ settings, setSettings, spaceCode, setSpaceCode, syncState, lastSync, onGenerate, onSync, onClear, onExportJson, onExportCsv, onImport }: {
  settings: Settings;
  setSettings: (settings: Settings) => void;
  spaceCode: string;
  setSpaceCode: (code: string) => void;
  syncState: SyncState;
  lastSync: string;
  onGenerate: () => void;
  onSync: () => void;
  onClear: () => void;
  onExportJson: () => void;
  onExportCsv: () => void;
  onImport: (file?: File) => void;
}) {
  const [draft, setDraft] = useState(spaceCode);
  useEffect(() => setDraft(spaceCode), [spaceCode]);
  return (
    <div className="stack">
      <section className="grid-two">
        <Panel title="目标">
          <div className="form-grid">
            <Field label="考试日期"><input type="date" value={settings.examDate} onChange={(event) => setSettings({ ...settings, examDate: event.target.value })} /></Field>
            <Field label="每日目标"><input inputMode="numeric" value={settings.dailyGoal} onChange={(event) => setSettings({ ...settings, dailyGoal: Number(event.target.value) || DEFAULT_SETTINGS.dailyGoal })} /></Field>
            <Field label="目标正确率"><input inputMode="numeric" value={settings.targetRate} onChange={(event) => setSettings({ ...settings, targetRate: Number(event.target.value) || DEFAULT_SETTINGS.targetRate })} /></Field>
          </div>
        </Panel>
        <Panel title="空间码同步" note="数据变化后合并上传，打开页面自动拉取">
          <div className="sync-line"><SyncIcon state={syncState} /><strong>{syncLabel(syncState)}</strong><span>{syncHint(syncState, spaceCode, lastSync)}</span></div>
          <div className="space-row">
            <input value={draft} onChange={(event) => setDraft(normalizeCode(event.target.value))} placeholder="输入或生成空间码" />
            <button className="primary-btn" onClick={() => setSpaceCode(draft)}><Save /> 保存</button>
          </div>
          <div className="button-row">
            <button className="soft-btn" onClick={onGenerate}><Wand2 /> 生成</button>
            <button className="soft-btn" onClick={onSync} disabled={!spaceCode}><RefreshCw /> 立即同步</button>
            <button className="soft-btn danger-text" onClick={onClear} disabled={!spaceCode}><CloudOff /> 清除</button>
          </div>
        </Panel>
      </section>

      <section className="grid-two">
        <Panel title="备份">
          <div className="button-row">
            <button className="soft-btn" onClick={onExportJson}><Download /> 导出 JSON</button>
            <button className="soft-btn" onClick={onExportCsv}><Download /> 导出 CSV</button>
            <label className="soft-btn file-btn"><Upload /> 导入 JSON<input type="file" accept="application/json,.json" onChange={(event) => onImport(event.target.files?.[0])} /></label>
          </div>
        </Panel>
        <Panel title="稳定性">
          <div className="stability-list">
            <div><strong>首屏</strong><span>核心资源未下载完时先显示轻量加载壳，避免白屏等待。</span></div>
            <div><strong>同步</strong><span>真实数据变化后 10 秒合并上传，打开页面和恢复网络时节流拉取。</span></div>
            <div><strong>缓存</strong><span>页面走新版优先，旧资源异常会自动清理缓存并恢复。</span></div>
          </div>
        </Panel>
      </section>

      <section className="grid-two">
        <Panel title="版本">
          <div className="version-panel">
            <strong>行测数据舱</strong>
            <span>本机保存，空间码自动同步，支持旧版 JSON 导入。</span>
            <small>xc.Pithiest.cn · Pithiest巨献</small>
          </div>
        </Panel>
      </section>
    </div>
  );
}

function Metric({ label, value, unit, icon }: { label: string; value: ReactNode; unit: string; icon: ReactNode }) {
  return <div className="metric"><div><span>{label}</span><strong>{value}</strong><small>{unit}</small></div>{icon}</div>;
}

function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return <section className="panel"><div className="panel-head"><div><h3>{title}</h3>{note && <span>{note}</span>}</div></div>{children}</section>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function ChartBox({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  return <div className={compact ? "chart-box compact" : "chart-box"}>{children}</div>;
}

function DeferredChart({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="chart-loading" aria-label="图表加载中"><i /></div>}>{children}</Suspense>;
}

function RecordCard({ record, onEdit, onDelete, action }: { record: TrainingRecord; onEdit: (record: TrainingRecord) => void; onDelete?: (record: TrainingRecord) => void; action?: ReactNode }) {
  const wrong = Math.max(0, record.total - record.correct);
  return (
    <article className="record-card">
      <i style={{ background: accent(record.module) }} />
      <div>
        <strong>{record.module} · {record.subType}</strong>
        <span>{record.date} · {record.correct}/{record.total} · 错 {wrong} · {paceText(record)}</span>
        {(record.tags.length > 0 || record.note) && <small>{[record.tags.join(" / "), record.note].filter(Boolean).join(" · ")}</small>}
      </div>
      <b>{percent(record.correct, record.total)}%</b>
      <div className="card-actions">
        <button className="icon-btn" onClick={() => onEdit(record)}><Edit3 /></button>
        {onDelete && <button className="icon-btn danger" onClick={() => onDelete(record)}><Trash2 /></button>}
        {action}
      </div>
    </article>
  );
}

function Bars({ rows, empty }: { rows: Array<{ name: string; value: number; hint?: string }>; empty: string }) {
  const max = Math.max(1, ...rows.map((item) => item.value));
  if (!rows.length) return <Empty text={empty} />;
  return (
    <div className="bars">
      {rows.map((item) => (
        <div key={item.name}>
          <span>{item.name}</span>
          <i><b style={{ width: `${Math.max(6, (item.value / max) * 100)}%` }} /></i>
          <strong>{item.hint || item.value}</strong>
        </div>
      ))}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="empty"><Sparkles /> {text}</div>;
}

function SyncIcon({ state }: { state: SyncState }) {
  if (state === "syncing") return <RefreshCw className="spin" />;
  if (state === "synced") return <CheckCircle2 />;
  if (state === "offline" || state === "error") return <CloudOff />;
  return <Cloud />;
}

function title(view: ViewId) {
  return { today: "训练总览", record: "训练录入", diagnosis: "专项诊断", review: "错题复盘", ledger: "训练台账", settings: "同步设置" }[view];
}

function syncLabel(state: SyncState) {
  return { local: "本机已保存", pending: "等待同步", syncing: "同步中", synced: "已同步", offline: "离线待同步", error: "同步异常" }[state];
}

function syncHint(state: SyncState, spaceCode: string, lastSync: string) {
  if (!spaceCode) return "设置空间码后跨设备使用";
  if (state === "pending") return "约 10 秒后合并上传";
  if (state === "syncing") return "正在处理云端数据";
  if (state === "synced") return lastSync ? `${lastSync} 已更新` : "云端已就绪";
  if (state === "offline") return "联网后自动继续";
  if (state === "error") return "稍后会继续尝试";
  return "本机优先保存";
}

function sameRecordList(left: TrainingRecord[], right: TrainingRecord[]) {
  if (left.length !== right.length) return false;
  return left.every((item, index) => {
    const other = right[index];
    return Boolean(other) && item.id === other.id && item.updatedAt === other.updatedAt && item.deletedAt === other.deletedAt;
  });
}

function formatTimer(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
