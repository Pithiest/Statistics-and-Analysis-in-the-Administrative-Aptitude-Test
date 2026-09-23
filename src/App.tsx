import "./practice.css";
import {useFenbiPractice} from "./useFenbiPractice";
import {practiceRecords} from "./fenbiPractice";
import {
  ArrowRight,
  CalendarDays,
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
import { flushSync } from "react-dom";
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
const MistakesWorkspace = lazy(() => import("./MistakesWorkspace").then((module) => ({ default: module.MistakesWorkspace })));
const LedgerRoute = lazy(() => import("./Views").then((module) => ({ default: module.Ledger })));
const PracticeRoute = lazy(() => import("./PracticeView").then(module => ({default:module.PracticeView})));
const SettingsRoute = lazy(() => import("./Views").then((module) => ({ default: module.SettingsView })));
type CoverageData = ReturnType<typeof dashboard>["coverage"];

export function App() {
  const [hydrated, setHydrated] = useState(false);
  const [openingView, setOpeningView] = useState<ViewId | null>(null);
  const [view, setView] = useState<ViewId>("today");
  const [reviewTab, setReviewTab] = useState<"questions" | "training" | "practice">("training");
  const fenbi=useFenbiPractice();
  const [statsSource,setStatsSource]=useState<"fenbi"|"manual"|null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [practiceKey,setPracticeKey]=useState<string|null>(null);
  const [records, setRecords] = useState<TrainingRecord[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [spaceCode, setSpaceCode] = useState("");
  const [syncState, setSyncState] = useState<SyncState>("local");
  const [lastSync, setLastSync] = useState("");
  const [toast, setToast] = useState("");
  const [undoRecord, setUndoRecord] = useState<TrainingRecord | null>(null);
  const [storageFailures, setStorageFailures] = useState<string[]>([]);
  const [updateReady, setUpdateReady] = useState(false);
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
  const toastTimerRef = useRef<number>();
  const elapsedMsRef = useRef(0);
  const timerStartedRef = useRef<number | null>(null);
  const navigationVersionRef = useRef(0);
  const reviewVisitedRef = useRef(false);
  const transitionRef = useRef<{ skipTransition: () => void } | null>(null);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);

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
      setHydrated(true);
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

  const source=fenbi.session?(statsSource||"fenbi"):"manual";
  const importedRecords=useMemo(()=>practiceRecords(fenbi.items),[fenbi.items]);
  const visibleRecords=source==="fenbi"?importedRecords:records;
  const data = useMemo(() => dashboard(visibleRecords, settings), [visibleRecords, settings]);
  const currentRecord = editingId ? records.find((item) => item.id === editingId) : undefined;

  useEffect(() => {
    recordsRef.current = records;
    if (!hydrated) return;
    reportStorage("训练记录", saveRecords(records));
  }, [records, hydrated]);

  useEffect(() => {
    settingsRef.current = settings;
    if (!hydrated) return;
    document.documentElement.dataset.theme = settings.theme;
    reportStorage("设置", saveSettings(settings));
  }, [settings, hydrated]);

  useEffect(() => {
    codeRef.current = spaceCode;
    if (!hydrated) return;
    reportStorage("空间码", saveSpaceCode(spaceCode));
  }, [spaceCode, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const persist = () => {
      reportStorage("训练记录", saveRecords(recordsRef.current));
      reportStorage("设置", saveSettings(settingsRef.current));
      reportStorage("空间码", saveSpaceCode(codeRef.current));
    };
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(persist, { timeout: 5000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = globalThis.setTimeout(persist, 2500);
    return () => globalThis.clearTimeout(id);
  }, [hydrated]);

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
    if (!timerOn) return;
    const update = () => setTimer(Math.floor(currentElapsedMs() / 1000));
    const id = window.setInterval(update, 250);
    window.addEventListener("visibilitychange", update);
    return () => { window.clearInterval(id); window.removeEventListener("visibilitychange", update); };
  }, [timerOn]);

  useEffect(() => {
    const ready = () => setUpdateReady(true);
    window.addEventListener("xingce:update-ready", ready);
    return () => {
      window.removeEventListener("xingce:update-ready", ready);
      window.clearTimeout(toastTimerRef.current);
      window.clearTimeout(debounceRef.current);
    };
  }, []);

  function reportStorage(key: string, success: boolean) {
    setStorageFailures((current) => {
      const next = success ? current.filter((item) => item !== key) : current.includes(key) ? current : [...current, key];
      return next.length === current.length && next.every((item, index) => item === current[index]) ? current : next;
    });
  }

  function currentElapsedMs() {
    return elapsedMsRef.current + (timerStartedRef.current === null ? 0 : Math.max(0, Date.now() - timerStartedRef.current));
  }

  function toggleTimer() {
    if (timerStartedRef.current !== null) {
      elapsedMsRef.current = currentElapsedMs();
      timerStartedRef.current = null;
      setTimer(Math.floor(elapsedMsRef.current / 1000));
      setTimerOn(false);
    } else {
      timerStartedRef.current = Date.now();
      setTimerOn(true);
    }
  }

  function resetTimer() {
    elapsedMsRef.current = 0;
    timerStartedRef.current = null;
    setTimer(0);
    setTimerOn(false);
  }

  function notify(message: string) {
    window.clearTimeout(toastTimerRef.current);
    setUndoRecord(null);
    setToast(message);
    toastTimerRef.current = window.setTimeout(() => setToast(""), 3600);
  }

  async function navigate(next: ViewId) {
    const version = ++navigationVersionRef.current;
    transitionRef.current?.skipTransition();
    if (next === view) { setOpeningView(null); return; }
    setOpeningView(next);
    try {
      await preloadView(next);
      if (version !== navigationVersionRef.current) return;
      const update = () => {
        if (version !== navigationVersionRef.current) return;
        flushSync(() => { setView(next); setOpeningView(null); });
        window.scrollTo({ top: 0, behavior: "instant" });
      };
      const doc = document as Document & { startViewTransition?: (callback: () => void) => { skipTransition: () => void } };
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches && doc.startViewTransition) {
        transitionRef.current = doc.startViewTransition(update);
      } else update();
    } catch {
      if (version !== navigationVersionRef.current) return;
      setOpeningView(null);
      notify("页面暂时未能加载，请稍后重试。当前记录已保留。");
    }
  }

  function openReview(tab?: "questions" | "training" | "practice") {
    if (tab) setReviewTab(tab);
    else if (!reviewVisitedRef.current) setReviewTab(source === "fenbi" ? "questions" : "training");
    reviewVisitedRef.current = true;
    void navigate("review");
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
    resetTimer();
    setForm((old) => {
      if (continueInput && !previous) {
        return { ...old, correct: "", errorReason: "无", note: "", tags: "", date: old.date || today() };
      }
      return { ...DEFAULT_FORM, date: today() };
    });
    setStatsSource("manual");
    scheduleSync();
    notify("训练已记录，可继续录入或到台账查看。");
  }

  function edit(record: TrainingRecord) {
    if(record.source==="fenbi"){setPracticeKey(record.sourceKey||null);openReview("practice");return;}
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
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function softDelete(record: TrainingRecord) {
    if(record.source==="fenbi")return;
    const now = new Date().toISOString();
    setRecords((list) => list.map((item) => (item.id === record.id ? { ...item, deletedAt: now, updatedAt: now } : item)));
    scheduleSync();
    notify("记录已删除。");
    setUndoRecord(record);
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => { setToast(""); setUndoRecord(null); }, 8000);
  }

  function undoDelete() {
    if (!undoRecord) return;
    const restored = { ...undoRecord, deletedAt: null, updatedAt: new Date().toISOString() };
    setRecords((list) => list.map((item) => item.id === restored.id ? restored : item));
    scheduleSync();
    notify("记录已恢复。");
  }

  function markReviewed(record: TrainingRecord) {
    if(record.source==="fenbi"){void fenbi.markReviewed(record.sourceKey!);return;}
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
    const elapsedSeconds = Math.floor(currentElapsedMs() / 1000);
    if (!elapsedSeconds) {
      notify("先开始计时，再填入用时。");
      return;
    }
    setForm((old) => ({ ...old, duration: String(Math.max(1, Math.ceil(elapsedSeconds / 60))) }));
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
        <SubjectSwitch />
        <nav className="side-nav" aria-label="主导航">
          {nav.map((item) => (
            <button
              key={item.id}
              className={view === item.id ? "active" : ""}
              aria-current={view === item.id ? "page" : undefined}
              aria-busy={openingView === item.id}
              onPointerEnter={() => void preloadView(item.id).catch(() => {})}
              onFocus={() => void preloadView(item.id).catch(() => {})}
              onClick={() => item.id === "review" ? openReview() : void navigate(item.id)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="sync-card" onClick={() => navigate("settings")} title="查看同步设置">
            <SyncIcon state={syncState} />
            <div>
              <strong>{storageFailures.length ? "本机保存受限" : syncLabel(syncState)}</strong>
              <span>{syncHint(syncState, spaceCode, lastSync)}</span>
            </div>
          </button>
          <span className="creator-mark">Pithiest巨献</span>
        </div>
      </aside>

      <main className="workspace">
        <div className="mobile-subject-switch"><SubjectSwitch compact /></div>
        {storageFailures.length > 0 && <div className="notice-banner is-warning" role="alert"><div><strong>本机保存遇到问题</strong><span>{storageFailures.join("、")}目前只留在本次页面，请先导出备份再关闭。</span></div><button className="soft-btn" onClick={() => download(`xingce-backup-${today()}.json`, JSON.stringify({ version: 7, records, settings }, null, 2), "application/json;charset=utf-8")} >导出备份</button></div>}
        {updateReady && <div className="notice-banner" role="status"><div><strong>新版本已就绪</strong><span>保存当前训练后，刷新即可使用。</span></div><button className="soft-btn" onClick={() => window.location.reload()}>刷新使用</button></div>}
        <header className="topbar">
          <div>
            <p className="workspace-eyebrow"><span>行测数据舱</span><span className="header-date"><CalendarDays />{new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date())}</span></p>
            <h1>{title(view)}</h1>
          </div>
          <div className="top-actions">
            <button className="icon-btn" aria-label={settings.theme === "dark" ? "切换浅色主题" : "切换深色主题"} onClick={() => updateSettings({ ...settings, theme: settings.theme === "dark" ? "light" : "dark" }, false)} title="切换主题">
              {settings.theme === "dark" ? <Sun /> : <Moon />}
            </button>
            <button className="icon-btn header-sync" aria-label={`保存状态：${storageFailures.length ? "本机保存受限" : syncLabel(syncState)}，打开设置`} title="查看保存与同步状态" onClick={() => void navigate("settings")}>
              <SyncIcon state={syncState} />
            </button>
            {view !== "today" && view !== "record" && <button className="primary-btn" onClick={source === "fenbi" ? () => openReview("practice") : () => void navigate("record")}>{source === "fenbi" ? <ListChecks /> : <Plus />}{source === "fenbi" ? "全部练习" : "录入训练"}</button>}
          </div>
        </header>

        {fenbi.session && ["today","diagnosis","ledger","review"].includes(view) && <div className="practice-source-bar"><div><strong>{source==="fenbi"?"粉笔自动记录":"手动训练记录"}</strong><span>{source==="fenbi"?`${fenbi.items.length} 次已完成练习 · ${!online ? "离线浏览本机缓存" : fenbi.error ? "同步暂不可用" : fenbi.loading ? "正在检查更新" : fenbi.account?.historyComplete ? "历史已补齐" : fenbi.account ? "历史正在补齐" : "正在读取状态"}`:"使用当前设备与空间码中的记录"}</span></div><select aria-label="统计数据来源" value={source} onChange={event=>setStatsSource(event.target.value as "fenbi"|"manual")}><option value="fenbi">粉笔自动记录</option><option value="manual">手动训练记录</option></select></div>}
        {fenbi.error && <div className="notice-banner is-warning" role="status"><span>{fenbi.error}</span><button className="soft-btn" onClick={() => void navigate("settings")}>管理账号</button></div>}
        <section key={view} className="page" aria-label={title(view)} aria-busy={!hydrated || openingView !== null}>
          {!hydrated ? <div className="panel route-loading" role="status"><RefreshCw className="spin" />正在恢复本机记录</div> : (
          <Suspense fallback={<div className="panel route-loading"><RefreshCw className="spin" /> 正在打开页面</div>}>
            {view === "today" && (
              <Today
                data={data}
                settings={settings}
                source={source}
                onRecord={() => navigate("record")}
                onPractice={() => openReview("practice")}
                onReview={() => openReview("training")}
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
                onTimer={toggleTimer}
                onResetTimer={resetTimer}
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
                records={visibleRecords}
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
            {view === "review" && <div className="stack">
              <div className="review-tabs" role="group" aria-label="复盘类型">
                <button aria-pressed={reviewTab === "questions"} className={reviewTab === "questions" ? "active" : ""} onClick={() => setReviewTab("questions")}>粉笔错题本</button>
                <button aria-pressed={reviewTab === "training"} className={reviewTab === "training" ? "active" : ""} onClick={() => setReviewTab("training")}>训练复盘{data.pending.length ? ` · ${data.pending.length}` : ""}</button>
                <button aria-pressed={reviewTab === "practice"} className={reviewTab === "practice"?"active":""} onClick={() => setReviewTab("practice")}>全部练习{fenbi.items.length?` · ${fenbi.items.length}`:""}</button>
              </div>
              {reviewTab === "questions" ? <div id="fenbi-review-slot" /> : reviewTab==="practice" ? <PracticeRoute items={fenbi.items} session={fenbi.session} account={fenbi.account} online={online} accountError={Boolean(fenbi.error)} selectedKey={practiceKey} onSelect={setPracticeKey} onSettings={()=>navigate("settings")} onReview={fenbi.markReviewed} /> : <ReviewRoute records={data.pending} onDone={markReviewed} onEdit={edit} onDelete={softDelete} />}
            </div>}
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
          )}
        </section>
        {hydrated && <Suspense fallback={null}><MistakesWorkspace mode={view==="settings"?"settings":view==="review"&&reviewTab==="questions"?"review":"background"} onSettings={()=>navigate("settings")} /></Suspense>}
      </main>

      <nav className="mobile-nav" aria-label="主导航">
        {nav.map((item) => (
          <button
            key={item.id}
            className={view === item.id ? "active" : ""}
            aria-current={view === item.id ? "page" : undefined}
            aria-busy={openingView === item.id}
            onPointerEnter={() => void preloadView(item.id).catch(() => {})}
            onFocus={() => void preloadView(item.id).catch(() => {})}
            onClick={() => item.id === "review" ? openReview() : void navigate(item.id)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className={toast ? "toast is-visible" : "toast"} role="status" aria-live="polite" aria-atomic="true"><span className="toast-dot" />{toast}{undoRecord && <button onClick={undoDelete}>撤销</button>}</div>
    </div>
  );
}

function SubjectSwitch({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "subject-switch is-compact" : "subject-switch"} role="group" aria-label="学习科目">
      {!compact && <span className="subject-switch-label">学习科目</span>}
      <div className="subject-switch-options">
        <span className="is-current" aria-current="page">行测</span>
        <a href="https://gz.pithiest.cn/" aria-label="前往公专训练网站">公专 <ArrowRight /></a>
      </div>
      <small>两科目记录各自保存</small>
    </div>
  );
}

function Today({
  data,
  settings,
  source,
  onRecord,
  onPractice,
  onReview,
  onDiagnose
}: {
  data: ReturnType<typeof dashboard>;
  settings: Settings;
  source: "fenbi" | "manual";
  onRecord: () => void;
  onPractice: () => void;
  onReview: () => void;
  onDiagnose: (module: ModuleName) => void;
}) {
  const radarData = data.moduleStats.map((item) => ({ module: item.short, 健康度: item.health, 样本: item.total }));
  const remaining = Math.max(0, settings.dailyGoal - data.todayTotal);
  const rateGap = data.todayTotal ? Math.max(0, settings.targetRate - data.todayRate) : 0;
  const leadPlan = data.coverage.nextPlan[0] || data.recommendations[0] || "先补一组真实训练，系统会继续更新下一步计划。";
  const topUndertrained = data.coverage.undertrained[0];
  const topStale = data.coverage.stale[0];
  const isFenbi = source === "fenbi";
  const heroTitle = isFenbi && !data.total
    ? "还没有同步到已完成练习"
    : isFenbi && !data.todayTotal
      ? "今天尚无已同步练习"
    : !data.total
    ? "从第一组训练开始"
    : !data.todayTotal
      ? "今天还没记录训练"
    : remaining
      ? `今天还差 ${remaining} 题`
      : "今日题量已达标";
  const heroDetail = isFenbi && !data.total
    ? "完成粉笔练习后，可到全部练习查看同步结果。"
    : isFenbi && !data.todayTotal
      ? "当前练习档案里还没有今天的记录；可查看最近练习与同步状态。"
    : !data.total
    ? "记录题量、用时和错因，让下一次练习更有方向。"
    : !data.todayTotal
      ? `近 7 天 ${data.weekTotal} 题，当前弱项 ${data.weak?.short || "待判断"}，先把今天的第一组样本补上。`
    : rateGap
      ? `今日正确率 ${data.todayRate}%，距离目标还差 ${rateGap} 个点。`
      : `今日正确率 ${data.todayRate}%，继续保持复盘节奏。`;
  return (
    <div className="stack dashboard-stack">
      <section className={`command-surface ${!data.total ? "is-empty" : ""}`}>
        <div className="command-head">
          <div>
            <p className="section-kicker">今日行动</p>
            <h2>{heroTitle}</h2>
            <span>{heroDetail}</span>
            <div className="command-actions">
            <button className="primary-btn" onClick={isFenbi ? onPractice : onRecord}>{isFenbi ? <ListChecks /> : <Plus />} {isFenbi ? "查看全部练习" : data.total ? "录入训练" : "记录第一组"}<ArrowRight /></button>
            {data.pending.length > 0 && <button className="soft-btn" onClick={onReview}><CheckCircle2 /> 训练复盘 {data.pending.length} 条</button>}
            </div>
          </div>
          <div className="daily-progress" aria-label={`今日已完成 ${data.todayTotal} 题，目标 ${settings.dailyGoal} 题`}>
            <svg viewBox="0 0 120 120" aria-hidden="true"><circle className="progress-track" cx="60" cy="60" r="52" /><circle className="progress-value" cx="60" cy="60" r="52" pathLength="100" strokeDasharray="100" strokeDashoffset={100 - Math.min(100, data.goalDone)} /></svg>
            <div><strong>{data.todayTotal}<small>题</small></strong><span>今日目标 {settings.dailyGoal}</span></div>
          </div>
        </div>

        <div className="signal-strip">
          <SignalMetric
            label="近 7 天题量"
            value={data.weekTotal}
            hint={`${signed(data.comparison.volumeDelta)} 题 / 上周期`}
            tone={deltaTone(data.comparison.volumeDelta)}
          />
          <SignalMetric
            label="近 7 天正确率"
            value={data.weekTotal ? `${data.weekRate}%` : "—"}
            hint={!data.weekTotal ? "有训练后开始计算" : data.comparison.previousTotal ? `${signed(data.comparison.rateDelta)} 个点 / 上周期` : "上周期暂无样本"}
            tone={data.comparison.previousTotal ? deltaTone(data.comparison.rateDelta) : "neutral"}
          />
          <SignalMetric
            label="复盘完成"
            value={data.review.total ? `${data.review.completionRate}%` : "—"}
            hint={data.review.total ? `${data.review.pending} 条待处理` : "还没有待复盘记录"}
            tone={!data.review.total ? "neutral" : data.review.pending ? "warning" : "good"}
          />
          <SignalMetric
            label="连续训练"
            value={`${data.streak} 天`}
            hint={`累计 ${data.activeDays} 个训练日`}
          />
        </div>

        {data.total > 0 ? <div className="command-core">
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
        </div> : <div className="getting-started">
          <div><span>01</span><div><strong>{isFenbi ? "查看练习档案" : "记录一组"}</strong><p>{isFenbi ? "已完成练习自动归档" : "题量、正确数、用时"}</p></div>{isFenbi ? <ListChecks /> : <Plus />}</div>
          <div><span>02</span><div><strong>找到薄弱点</strong><p>按模块和题型查看诊断</p></div><BarChart3 /></div>
          <div><span>03</span><div><strong>复盘再练</strong><p>把错因变成下一步行动</p></div><ListChecks /></div>
        </div>}
      </section>

      <section className="surface-section module-health-surface">
        <div className="panel-head">
          <div><h3>各模块表现</h3><span>{data.total ? "综合正确率、配速、样本与复盘情况 · 点击模块查看诊断" : "从任意模块开始积累，点击查看各题型"}</span></div>
          {data.total > 0 && <strong className="matrix-score">{Math.round(data.moduleStats.reduce((sum, item) => sum + item.health, 0) / data.moduleStats.length)}<small>综合健康度 /100</small></strong>}
        </div>
        <div className={`module-health-grid ${!data.total ? "no-chart" : ""}`}>
          <ModuleOpsTable rows={data.moduleStats} onDiagnose={onDiagnose} />
          {data.total > 0 && <div className="radar-surface">
            {data.total ? (
              <ChartBox compact>
                <DeferredChart>
                  <ModuleRadarChart data={radarData} />
                </DeferredChart>
              </ChartBox>
            ) : <Empty text="录入后生成模块矩阵。" />}
          </div>}
        </div>
      </section>

      {data.total > 0 && <>
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
      </>}
      <footer className="dashboard-note">每一次记录，都是下一次进步的依据。<span>本机保存 · 空间码同步</span></footer>
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
        <button className="ops-row" data-empty={!item.total} key={item.id} onClick={() => onDiagnose(item.name)}>
          <span><i style={{ background: item.accent }} /><b>{item.name}</b></span>
          <strong><em style={{ width: `${item.health}%` }} /><b className="health-value">{item.total ? item.health : "待积累"}</b></strong>
          <b className="ops-rate">{item.total ? `${item.rate}%` : "--"}</b>
          <b className="ops-volume">{item.total}</b>
          <small className="ops-date">{item.lastDate ? item.lastDate.slice(5).replace("-", "/") : "未训练"}</small>
          <small className={`ops-pending ${item.pending ? "status-alert" : ""}`}>{item.pending || 0}</small>
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
  if (view === "today") return Promise.resolve();
  if (view === "review") return Promise.all([import("./Views"), import("./MistakesWorkspace")]);
  return import("./Views");
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
