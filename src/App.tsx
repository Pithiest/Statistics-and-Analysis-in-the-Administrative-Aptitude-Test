import {
  BarChart3,
  CheckCircle2,
  Cloud,
  CloudOff,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Moon,
  Plus,
  RefreshCw,
  Sparkles,
  Sun,
  Table2,
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
            <button
              key={item.id}
              className={view === item.id ? "active" : ""}
              onPointerEnter={() => preloadView(item.id)}
              onFocus={() => preloadView(item.id)}
              onClick={() => navigate(item.id)}
            >
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
            {view === "today" && (
              <Today
                data={data}
                settings={settings}
                onRecord={() => navigate("record")}
                onReview={() => navigate("review")}
                onDiagnose={(module) => {
                  setDiagnosisModule(module);
                  setDiagnosisSub("全部题型");
                  navigate("diagnosis");
                }}
              />
            )}
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
          <button
            key={item.id}
            className={view === item.id ? "active" : ""}
            onPointerEnter={() => preloadView(item.id)}
            onFocus={() => preloadView(item.id)}
            onClick={() => navigate(item.id)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function Today({
  data,
  settings,
  onRecord,
  onReview,
  onDiagnose
}: {
  data: ReturnType<typeof dashboard>;
  settings: Settings;
  onRecord: () => void;
  onReview: () => void;
  onDiagnose: (module: ModuleName) => void;
}) {
  const radarData = data.moduleStats.map((item) => ({ module: item.short, 健康度: item.health, 样本: item.total }));
  const remaining = Math.max(0, settings.dailyGoal - data.todayTotal);
  const rateGap = data.todayTotal ? Math.max(0, settings.targetRate - data.todayRate) : 0;
  const leadPlan = data.coverage.nextPlan[0] || data.recommendations[0] || "先补一组真实训练，系统会继续更新下一步计划。";
  const topUndertrained = data.coverage.undertrained[0];
  const topStale = data.coverage.stale[0];
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
      ? `近 7 天 ${data.weekTotal} 题，当前弱项 ${data.weak?.short || "待判断"}，先把今天的第一组样本补上。`
    : rateGap
      ? `今日正确率 ${data.todayRate}%，距离目标还差 ${rateGap} 个点。`
      : `今日正确率 ${data.todayRate}%，继续保持复盘节奏。`;
  return (
    <div className="stack dashboard-stack">
      <section className="command-surface">
        <div className="command-head">
          <div>
            <p className="section-kicker">今日行动</p>
            <h2>{heroTitle}</h2>
            <span>{heroDetail}</span>
          </div>
          <div className="command-actions">
            <button className="primary-btn" onClick={onRecord}><Plus /> 录入训练</button>
            <button className="soft-btn" onClick={onReview}><ListChecks /> 处理复盘</button>
          </div>
        </div>

        <div className="signal-strip">
          <SignalMetric
            label="今日进度"
            value={`${data.todayTotal}/${settings.dailyGoal}`}
            hint={`${data.goalDone}% · ${data.todayRate || 0}% 正确率`}
            progress={data.goalDone}
          />
          <SignalMetric
            label="近 7 天题量"
            value={data.weekTotal}
            hint={`${signed(data.comparison.volumeDelta)} 题 / 上周期`}
            tone={deltaTone(data.comparison.volumeDelta)}
          />
          <SignalMetric
            label="近 7 天正确率"
            value={`${data.weekRate}%`}
            hint={`${signed(data.comparison.rateDelta)} 个点 / 上周期`}
            tone={deltaTone(data.comparison.rateDelta)}
          />
          <SignalMetric
            label="复盘完成"
            value={`${data.review.completionRate}%`}
            hint={`${data.review.pending} 条待处理`}
            tone={data.review.pending ? "warning" : "good"}
          />
          <SignalMetric
            label="连续训练"
            value={`${data.streak} 天`}
            hint={`累计 ${data.activeDays} 个训练日`}
          />
        </div>

        <div className="command-core">
          <div className="trend-surface">
            <div className="panel-head compact-head">
              <div><h3>14 天训练走势</h3><span>题量与正确率</span></div>
              <strong className="trend-summary">{data.totalRate}%<small>累计正确率</small></strong>
            </div>
            {data.total ? (
              <ChartBox>
                <DeferredChart>
                  <OverviewTrendChart data={data.trend} targetRate={settings.targetRate} />
                </DeferredChart>
              </ChartBox>
            ) : <Empty text="录入后生成趋势。" />}
          </div>
          <aside className="next-action">
            <div>
              <p className="section-kicker">下一组</p>
              <h3>{leadPlan}</h3>
            </div>
            <dl className="action-facts">
              <div><dt>题量缺口</dt><dd>{topUndertrained ? `${topUndertrained.moduleShort} · ${topUndertrained.subType}` : "等待样本"}</dd></div>
              <div><dt>手感缺口</dt><dd>{topStale ? `${topStale.moduleShort} · ${topStale.subType}` : "等待样本"}</dd></div>
              <div><dt>题型均衡</dt><dd>{data.coverage.balanceScore}/100</dd></div>
            </dl>
            <p className="daily-quote">{data.quote}</p>
          </aside>
        </div>
      </section>

      <section className="surface-section module-health-surface">
        <div className="panel-head">
          <div><h3>模块健康矩阵</h3><span>健康度综合正确率、配速、样本、训练新鲜度与复盘完成情况</span></div>
          <strong className="matrix-score">{Math.round(data.moduleStats.reduce((sum, item) => sum + item.health, 0) / data.moduleStats.length)}<small>/100</small></strong>
        </div>
        <div className="module-health-grid">
          <ModuleOpsTable rows={data.moduleStats} onDiagnose={onDiagnose} />
          <div className="radar-surface">
            {data.total ? (
              <ChartBox compact>
                <DeferredChart>
                  <ModuleRadarChart data={radarData} />
                </DeferredChart>
              </ChartBox>
            ) : <Empty text="录入后生成模块矩阵。" />}
          </div>
        </div>
      </section>

      <section className="operations-grid">
        <section className="surface-section">
          <div className="panel-head"><div><h3>训练编排</h3><span>题量覆盖、久未训练和下一步安排</span></div></div>
          <StudyPlan coverage={data.coverage} />
          <CoverageBoard coverage={data.coverage} />
        </section>
        <section className="surface-section">
          <div className="panel-head"><div><h3>复盘队列</h3><span>{data.pending.length ? `${data.pending.length} 条待处理` : "当前没有积压"}</span></div></div>
          <ReviewPreview records={data.pending} onReview={onReview} />
        </section>
      </section>

      <section className="insight-band">
        <div>
          <div className="panel-head compact-head"><div><h3>错因结构</h3><span>按错题数汇总</span></div></div>
          {data.reasons.length ? (
            <Bars rows={data.reasons.map((item) => ({ name: item.name, value: item.value, hint: `${item.value}错` }))} empty="暂无错因数据" />
          ) : <Empty text="暂无错因数据。" />}
        </div>
        <div>
          <div className="panel-head compact-head"><div><h3>训练热力</h3><span>近 35 天题量分布</span></div></div>
          <div className="heatmap">
            {data.heatmap.map((item) => <span key={item.date} data-level={item.level} title={`${item.date} · ${item.total} 题`} />)}
          </div>
          <ul className="advice compact-list">{data.recommendations.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      </section>
    </div>
  );
}

function SignalMetric({ label, value, hint, tone = "neutral", progress }: {
  label: string;
  value: ReactNode;
  hint: string;
  tone?: "neutral" | "good" | "warning" | "bad";
  progress?: number;
}) {
  return (
    <div className={`signal-metric tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
      {typeof progress === "number" && <i><b style={{ width: `${progress}%` }} /></i>}
    </div>
  );
}

function ModuleOpsTable({ rows, onDiagnose }: {
  rows: ReturnType<typeof dashboard>["moduleStats"];
  onDiagnose: (module: ModuleName) => void;
}) {
  return (
    <div className="ops-table">
      <div className="ops-head"><span>模块</span><span>健康度</span><span>正确率</span><span>题量</span><span>最近训练</span><span>复盘</span></div>
      {rows.map((item) => (
        <button className="ops-row" key={item.id} onClick={() => onDiagnose(item.name)}>
          <span><i style={{ background: item.accent }} /><b>{item.name}</b></span>
          <strong><em style={{ width: `${item.health}%` }} /><b className="health-value">{item.health}</b></strong>
          <b>{item.total ? `${item.rate}%` : "--"}</b>
          <b>{item.total}</b>
          <small>{item.lastDate ? `${item.freshness} 分` : "未训练"}</small>
          <small className={item.pending ? "status-alert" : ""}>{item.pending || 0}</small>
        </button>
      ))}
    </div>
  );
}

function signed(value: number) {
  if (!value) return "0";
  return value > 0 ? `+${value}` : String(value);
}

function deltaTone(value: number): "neutral" | "good" | "bad" {
  if (!value) return "neutral";
  return value > 0 ? "good" : "bad";
}

function preloadView(view: ViewId) {
  if (view === "today") return;
  void import("./Views");
  if (view === "diagnosis") void import("./Charts");
}

function ReviewPreview({ records, onReview }: { records: TrainingRecord[]; onReview: () => void }) {
  if (!records.length) return <Empty text="暂无待复盘记录。" />;
  return (
    <div className="review-preview">
      {records.slice(0, 4).map((item) => (
        <div key={item.id}>
          <span>{item.date}</span>
          <strong>{item.module} · {item.subType}</strong>
          <small>{item.correct}/{item.total} · 错 {Math.max(0, item.total - item.correct)} · {item.errorReason}</small>
        </div>
      ))}
      <button className="soft-btn" onClick={onReview}><ListChecks /> 查看全部</button>
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
