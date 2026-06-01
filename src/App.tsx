import {
  BarChart3,
  CheckCircle2,
  Clock3,
  Cloud,
  CloudOff,
  Flame,
  Gauge,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Moon,
  Plus,
  RefreshCw,
  Sparkles,
  Sun,
  Table2,
  Target,
} from "./icons";
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  DEFAULT_FORM,
  DEFAULT_SETTINGS,
  createRecord,
  dashboard,
  exportCsv,
  formFromTemplate,
  generateCode,
  loadState,
  markReviewedRecord,
  normalizeCode,
  normalizeRecords,
  normalizeSettings,
  paceSeconds,
  percent,
  saveRecords,
  saveSettings,
  saveSpaceCode,
  stampSettings,
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
const RecordRoute = lazy(() => import("./Views").then((module) => ({ default: module.RecordView })));
const DiagnosisRoute = lazy(() => import("./Views").then((module) => ({ default: module.Diagnosis })));
const ReviewRoute = lazy(() => import("./Views").then((module) => ({ default: module.Review })));
const LedgerRoute = lazy(() => import("./Views").then((module) => ({ default: module.Ledger })));
const SettingsRoute = lazy(() => import("./Views").then((module) => ({ default: module.SettingsView })));
type CoverageData = ReturnType<typeof dashboard>["coverage"];

export function App() {
  const [view, setView] = useState<ViewId>("today");
  const [records, setRecords] = useState<TrainingRecord[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [spaceCode, setSpaceCode] = useState("");
  const [syncState, setSyncState] = useState<SyncState>("local");
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
  const recordsHydratedRef = useRef(false);
  const settingsHydratedRef = useRef(false);
  const codeHydratedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timeoutId = 0;
    const hydrate = () => {
      if (cancelled) return;
      const loaded = loadState();
      recordsRef.current = loaded.records;
      settingsRef.current = loaded.settings;
      codeRef.current = loaded.spaceCode;
      setRecords(loaded.records);
      setSettings(loaded.settings);
      setSpaceCode(loaded.spaceCode);
      setSyncState(loaded.spaceCode ? "syncing" : "local");
    };
    const frameId = window.requestAnimationFrame(() => {
      timeoutId = window.setTimeout(hydrate, 0);
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
    };
  }, []);

  const data = useMemo(() => dashboard(records, settings), [records, settings]);
  const currentRecord = editingId ? records.find((item) => item.id === editingId) : undefined;

  useEffect(() => {
    recordsRef.current = records;
    if (!recordsHydratedRef.current) {
      recordsHydratedRef.current = true;
      return;
    }
    saveRecords(records);
  }, [records]);

  useEffect(() => {
    settingsRef.current = settings;
    document.documentElement.dataset.theme = settings.theme;
    if (!settingsHydratedRef.current) {
      settingsHydratedRef.current = true;
      return;
    }
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    codeRef.current = spaceCode;
    if (!codeHydratedRef.current) {
      codeHydratedRef.current = true;
      return;
    }
    saveSpaceCode(spaceCode);
  }, [spaceCode]);

  useEffect(() => {
    const persist = () => {
      saveRecords(recordsRef.current);
      saveSettings(settingsRef.current);
      saveSpaceCode(codeRef.current);
    };
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(persist, { timeout: 5000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = globalThis.setTimeout(persist, 2500);
    return () => globalThis.clearTimeout(id);
  }, []);

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
      const { syncSpace } = await import("./cloudSync");
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
          <Suspense fallback={<div className="panel route-loading"><RefreshCw className="spin" /> 正在打开页面</div>}>
            {view === "today" && <Today data={data} settings={settings} onRecord={() => navigate("record")} onReview={() => navigate("review")} />}
            {view === "record" && (
              <RecordRoute
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
              <DiagnosisRoute
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
            {view === "review" && <ReviewRoute records={data.pending} onDone={markReviewed} onEdit={edit} onDelete={softDelete} />}
            {view === "ledger" && (
              <LedgerRoute
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
              <SettingsRoute
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
          </Suspense>
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
    : !data.todayTotal
      ? "今天还没记录训练"
    : remaining
      ? `今天还差 ${remaining} 题`
      : "今日题量已达标";
  const heroDetail = !data.total
    ? "录入一组真实训练后，系统会开始判断题量、正确率、错因和配速。"
    : !data.todayTotal
      ? data.coverage.nextPlan[0] || "先补一组短训练，再看今天的正确率和配速。"
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

      <section className="grid-two plan-grid">
        <Panel title="下一步学习计划" note={`均衡指数 ${data.coverage.balanceScore}/100`}>
          <StudyPlan coverage={data.coverage} />
        </Panel>
        <Panel title="题型覆盖" note="题量均衡 / 久未训练">
          <CoverageBoard coverage={data.coverage} />
        </Panel>
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

function StudyPlan({ coverage }: { coverage: CoverageData }) {
  return (
    <div className="study-plan">
      <div className="plan-score">
        <span>覆盖均衡</span>
        <strong>{coverage.balanceScore}</strong>
        <small>满分 100</small>
      </div>
      <ol>
        {coverage.nextPlan.map((item) => <li key={item}>{item}</li>)}
      </ol>
    </div>
  );
}

function CoverageBoard({ coverage }: { coverage: CoverageData }) {
  const undertrained = coverage.undertrained.slice(0, 4);
  const stale = coverage.stale.slice(0, 4);
  return (
    <div className="coverage-board">
      <CoverageColumn title="题量偏少" rows={undertrained} mode="total" />
      <CoverageColumn title="久未训练" rows={stale} mode="stale" />
    </div>
  );
}

function CoverageColumn({ title, rows, mode }: { title: string; rows: CoverageData["items"]; mode: "total" | "stale" }) {
  return (
    <div className="coverage-column">
      <span>{title}</span>
      {rows.length ? rows.map((item) => (
        <div key={`${title}-${item.key}`} className="coverage-item">
          <b>{item.moduleShort} · {item.subType}</b>
          <small>{mode === "total" ? `${item.total} 题` : item.lastDate ? `${item.daysSince} 天未做` : "从未记录"}</small>
        </div>
      )) : <Empty text="暂时没有明显缺口。" />}
    </div>
  );
}

function Metric({ label, value, unit, icon }: { label: string; value: ReactNode; unit: string; icon: ReactNode }) {
  return <div className="metric"><div><span>{label}</span><strong>{value}</strong><small>{unit}</small></div>{icon}</div>;
}

function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return <section className="panel"><div className="panel-head"><div><h3>{title}</h3>{note && <span>{note}</span>}</div></div>{children}</section>;
}

function ChartBox({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  return <div className={compact ? "chart-box compact" : "chart-box"}>{children}</div>;
}

function DeferredChart({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (ready) return undefined;
    const node = ref.current;
    if (!node || !("IntersectionObserver" in window)) {
      setReady(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setReady(true);
        observer.disconnect();
      },
      { rootMargin: "360px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ready]);

  return (
    <div ref={ref} className="deferred-chart">
      {ready ? <Suspense fallback={<div className="chart-loading" aria-label="图表加载中"><i /></div>}>{children}</Suspense> : <div className="chart-loading" aria-label="图表等待可见"><i /></div>}
    </div>
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
