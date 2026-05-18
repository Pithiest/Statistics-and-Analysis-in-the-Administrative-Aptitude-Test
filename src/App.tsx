import { AnimatePresence, motion } from "framer-motion";
import {
  BarChart3,
  CheckCircle2,
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
  Plus,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Sun,
  Table2,
  TimerReset,
  Trash2,
  Upload,
  Wand2
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  DEFAULT_FORM,
  DEFAULT_SETTINGS,
  ERROR_REASONS,
  MODULES,
  accent,
  createRecord,
  dashboard,
  exportCsv,
  firstSubType,
  generateCode,
  loadState,
  moduleDetail,
  normalizeCode,
  normalizeRecords,
  normalizeSettings,
  paceLabel,
  percent,
  saveRecords,
  saveSettings,
  saveSpaceCode,
  shortName,
  suggestedMinutes,
  syncSpace,
  today
} from "./model";
import type { EntryForm, ModuleName, Settings, SyncState, TrainingRecord, ViewId } from "./model";

const nav: Array<{ id: ViewId; label: string; icon: ReactNode }> = [
  { id: "today", label: "总览", icon: <LayoutDashboard /> },
  { id: "record", label: "录入", icon: <Plus /> },
  { id: "diagnosis", label: "诊断", icon: <BarChart3 /> },
  { id: "review", label: "复盘", icon: <ListChecks /> },
  { id: "ledger", label: "台账", icon: <Table2 /> },
  { id: "settings", label: "设置", icon: <KeyRound /> }
];

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
  const [ledgerQuery, setLedgerQuery] = useState("");
  const [ledgerModule, setLedgerModule] = useState<ModuleName | "全部">("全部");
  const [diagnosisModule, setDiagnosisModule] = useState<ModuleName>("言语理解");
  const recordsRef = useRef(records);
  const settingsRef = useRef(settings);
  const codeRef = useRef(spaceCode);
  const syncingRef = useRef(false);
  const debounceRef = useRef<number>();

  const data = useMemo(() => dashboard(records, settings), [records, settings]);
  const currentModule = MODULES.find((item) => item.name === form.module) || MODULES[0];

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
    void syncNow();
    const interval = window.setInterval(() => void syncNow(), 20_000);
    const focus = () => void syncNow();
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
    window.setTimeout(() => setToast(""), 2300);
  }

  function scheduleSync() {
    if (!codeRef.current) {
      setSyncState("local");
      return;
    }
    if (!navigator.onLine) {
      setSyncState("offline");
      return;
    }
    window.clearTimeout(debounceRef.current);
    setSyncState("syncing");
    debounceRef.current = window.setTimeout(() => void syncNow(), 800);
  }

  async function syncNow() {
    const code = normalizeCode(codeRef.current);
    if (!code || syncingRef.current) return;
    if (!navigator.onLine) {
      setSyncState("offline");
      return;
    }
    syncingRef.current = true;
    setSyncState("syncing");
    try {
      const next = await syncSpace(code, recordsRef.current, settingsRef.current);
      setRecords(next.records);
      setSettings(next.settings);
      setLastSync(new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }));
      setSyncState("synced");
    } catch (error) {
      console.error(error);
      setSyncState("error");
      notify("同步失败，稍后会继续尝试。");
    } finally {
      syncingRef.current = false;
    }
  }

  function updateSettings(next: Settings) {
    setSettings(normalizeSettings({ ...next, updatedAt: new Date().toISOString() }));
    scheduleSync();
  }

  function submit(continueInput = false) {
    const previous = editingId ? records.find((item) => item.id === editingId) : undefined;
    const nextRecord = createRecord({ ...form, duration: form.duration || suggestedMinutes(form.module, form.total) }, previous);
    if (!nextRecord) {
      notify("题量和正确数需要重新检查。");
      return;
    }
    setRecords((list) => (previous ? list.map((item) => (item.id === previous.id ? nextRecord : item)) : [nextRecord, ...list]));
    setEditingId(null);
    setTimer(0);
    setTimerOn(false);
    setForm((old) => ({
      ...DEFAULT_FORM,
      date: continueInput ? old.date : today(),
      module: continueInput ? old.module : "全模块测试",
      subType: continueInput ? old.subType : "套卷混合",
      total: continueInput ? old.total : "100",
      duration: continueInput ? old.duration : "90"
    }));
    scheduleSync();
    notify(spaceCode ? "已保存，后台自动同步。" : "已保存到本机。");
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
    setView("record");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function softDelete(record: TrainingRecord) {
    const now = new Date().toISOString();
    setRecords((list) => list.map((item) => (item.id === record.id ? { ...item, deletedAt: now, updatedAt: now } : item)));
    scheduleSync();
    notify("记录已删除。");
  }

  function markReviewed(record: TrainingRecord) {
    setRecords((list) => list.map((item) => (item.id === record.id ? { ...item, reviewStatus: "reviewed", updatedAt: new Date().toISOString() } : item)));
    scheduleSync();
  }

  function importBackup(file?: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || "{}"));
        const imported = normalizeRecords(Array.isArray(parsed) ? parsed : parsed.records);
        if (!imported.length) throw new Error("empty");
        setRecords((list) => [...imported, ...list]);
        if (parsed.settings) setSettings(normalizeSettings(parsed.settings));
        scheduleSync();
        notify(`已导入 ${imported.length} 条记录。`);
      } catch {
        notify("导入失败，请检查备份文件。");
      }
    };
    reader.readAsText(file);
  }

  function download(name: string, content: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  }

  const ledger = data.rows.filter((item) => {
    const text = `${item.date} ${item.module} ${item.subType} ${item.errorReason} ${item.tags.join(" ")} ${item.note}`.toLowerCase();
    return (ledgerModule === "全部" || item.module === ledgerModule) && (!ledgerQuery || text.includes(ledgerQuery.toLowerCase()));
  });

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/pithiest-icon.svg" alt="" />
          <div>
            <strong>行测统计</strong>
            <span>训练数据系统</span>
          </div>
        </div>
        <nav className="side-nav">
          {nav.map((item) => (
            <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}>
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sync-card">
          <SyncIcon state={syncState} />
          <div>
            <strong>{syncLabel(syncState)}</strong>
            <span>{spaceCode ? lastSync || "后台自动同步" : "设置空间码后跨设备使用"}</span>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p>XINGCE TRAINING STUDIO</p>
            <h1>{title(view)}</h1>
          </div>
          <div className="top-actions">
            <button className="icon-btn" onClick={() => updateSettings({ ...settings, theme: settings.theme === "dark" ? "light" : "dark" })} title="切换主题">
              {settings.theme === "dark" ? <Sun /> : <Moon />}
            </button>
            <button className="soft-btn" onClick={() => setView("settings")}>
              <KeyRound /> 空间码
            </button>
            <button className="primary-btn" onClick={() => setView("record")}>
              <Plus /> 录入
            </button>
          </div>
        </header>

        <AnimatePresence mode="wait">
          <motion.section key={view} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.22 }} className="page">
            {view === "today" && <Today data={data} settings={settings} onRecord={() => setView("record")} onReview={() => setView("review")} />}
            {view === "record" && (
              <RecordView
                form={form}
                setForm={setForm}
                currentModule={currentModule}
                timer={timer}
                timerOn={timerOn}
                editing={Boolean(editingId)}
                onTimer={() => setTimerOn((value) => !value)}
                onResetTimer={() => {
                  setTimer(0);
                  setTimerOn(false);
                }}
                onSave={() => submit(false)}
                onSaveContinue={() => submit(true)}
              />
            )}
            {view === "diagnosis" && <Diagnosis records={records} settings={settings} module={diagnosisModule} setModule={setDiagnosisModule} onEdit={edit} />}
            {view === "review" && <Review records={data.pending} onDone={markReviewed} onEdit={edit} onDelete={softDelete} />}
            {view === "ledger" && <Ledger records={ledger} query={ledgerQuery} module={ledgerModule} onQuery={setLedgerQuery} onModule={setLedgerModule} onEdit={edit} onDelete={softDelete} />}
            {view === "settings" && (
              <SettingsView
                settings={settings}
                setSettings={updateSettings}
                spaceCode={spaceCode}
                setSpaceCode={(code) => {
                  setSpaceCode(normalizeCode(code));
                  setSyncState("syncing");
                  window.setTimeout(() => void syncNow(), 0);
                }}
                syncState={syncState}
                lastSync={lastSync}
                onGenerate={() => setSpaceCode(generateCode())}
                onSync={() => void syncNow()}
                onClear={() => {
                  setSpaceCode("");
                  setSyncState("local");
                }}
                onExportJson={() => download(`xingce-backup-${today()}.json`, JSON.stringify({ version: 5, records: data.rows, settings }, null, 2), "application/json")}
                onExportCsv={() => download(`xingce-ledger-${today()}.csv`, exportCsv(data.rows), "text/csv;charset=utf-8")}
                onImport={importBackup}
              />
            )}
          </motion.section>
        </AnimatePresence>
      </main>

      <nav className="mobile-nav">
        {nav.map((item) => (
          <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}>
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
  return (
    <div className="stack">
      <section className="hero">
        <div>
          <p>TODAY COMMAND</p>
          <h2>{data.total ? "把训练变成可复盘的优势" : "从第一条记录开始建立优势"}</h2>
          <span>今日 {data.todayTotal} 题，累计 {data.total} 题，当前正确率 {data.totalRate}%。</span>
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

      <div className="notice"><Sparkles /> {data.quote}</div>

      <section className="metric-grid">
        <Metric label="今日题量" value={data.todayTotal} unit={`目标 ${settings.dailyGoal}`} icon={<Flame />} />
        <Metric label="今日正确率" value={`${data.todayRate}%`} unit={`目标 ${settings.targetRate}%`} icon={<CheckCircle2 />} />
        <Metric label="复盘队列" value={data.pending.length} unit="条待处理" icon={<ListChecks />} />
        <Metric label="累计题量" value={data.total} unit="题" icon={<Gauge />} />
      </section>

      <section className="grid-two">
        <Panel title="14 天趋势">
          <div className="trend">
            {data.trend.map((item) => (
              <div key={item.date} title={`${item.date} · ${item.total}题`}>
                <i style={{ height: `${Math.max(4, Math.min(100, item.total))}%` }} />
                <span>{item.date.slice(3)}</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="模块状态">
          <div className="module-list">
            {data.moduleStats.map((item) => (
              <div key={item.id}>
                <span style={{ color: item.accent }}>{item.short}</span>
                <strong>{item.total ? `${item.rate}%` : "--"}</strong>
                <i><b style={{ width: `${item.rate}%`, background: item.accent }} /></i>
              </div>
            ))}
          </div>
        </Panel>
      </section>

      <section className="grid-two">
        <Panel title="训练热力">
          <div className="heatmap">
            {data.heatmap.map((item) => <span key={item.date} data-level={item.level} title={`${item.date} · ${item.total}题`} />)}
          </div>
        </Panel>
        <Panel title="下一步">
          <ul className="advice">
            <li>{data.pending.length ? `先复盘最近 ${Math.min(3, data.pending.length)} 条记录。` : "复盘队列清爽，可以追加一组混合训练。"}</li>
            <li>{data.weak ? `${data.weak.short} 目前最需要关注。` : "先录入一组完整数据，系统会自动判断弱项。"}</li>
            <li>{data.todayTotal < settings.dailyGoal ? `今日还差 ${Math.max(0, settings.dailyGoal - data.todayTotal)} 题。` : "今日目标已完成。"}</li>
          </ul>
        </Panel>
      </section>
    </div>
  );
}

function RecordView({ form, setForm, currentModule, timer, timerOn, editing, onTimer, onResetTimer, onSave, onSaveContinue }: {
  form: EntryForm;
  setForm: (next: EntryForm) => void;
  currentModule: (typeof MODULES)[number];
  timer: number;
  timerOn: boolean;
  editing: boolean;
  onTimer: () => void;
  onResetTimer: () => void;
  onSave: () => void;
  onSaveContinue: () => void;
}) {
  const setModule = (module: ModuleName) => {
    setForm({ ...form, module, subType: firstSubType(module), duration: suggestedMinutes(module, form.total) });
  };
  const setTotal = (total: string) => setForm({ ...form, total, duration: suggestedMinutes(form.module, total) });
  return (
    <div className="stack">
      <section className="form-layout">
        <Panel title={editing ? "编辑训练" : "录入训练"}>
          <div className="form-grid">
            <Field label="日期"><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
            <Field label="模块">
              <select value={form.module} onChange={(e) => setModule(e.target.value as ModuleName)}>
                {MODULES.map((item) => <option key={item.id}>{item.name}</option>)}
              </select>
            </Field>
            <Field label="题型">
              <select value={form.subType} onChange={(e) => setForm({ ...form, subType: e.target.value })}>
                {currentModule.subTypes.map((item) => <option key={item}>{item}</option>)}
              </select>
            </Field>
            <Field label="题量"><input inputMode="numeric" value={form.total} onChange={(e) => setTotal(e.target.value)} /></Field>
            <Field label="正确数"><input inputMode="numeric" value={form.correct} onChange={(e) => setForm({ ...form, correct: e.target.value })} /></Field>
            <Field label="用时">
              <input inputMode="numeric" value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} />
            </Field>
            <Field label="主要错因">
              <select value={form.errorReason} onChange={(e) => setForm({ ...form, errorReason: e.target.value })}>
                {ERROR_REASONS.map((item) => <option key={item}>{item}</option>)}
              </select>
            </Field>
            <Field label="标签"><input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="可选，用空格分隔" /></Field>
          </div>
          <Field label="备注"><textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="这组题暴露了什么问题？" /></Field>
          <div className="button-row">
            <button className="primary-btn" onClick={onSave}><Save /> 保存</button>
            <button className="soft-btn" onClick={onSaveContinue}><Plus /> 保存并继续</button>
          </div>
        </Panel>
        <Panel title="计时">
          <div className="timer">
            <strong>{formatTimer(timer)}</strong>
            <div className="button-row">
              <button className="primary-btn" onClick={onTimer}>{timerOn ? "暂停" : "开始"}</button>
              <button className="soft-btn" onClick={onResetTimer}><TimerReset /> 重置</button>
            </div>
          </div>
        </Panel>
      </section>
    </div>
  );
}

function Diagnosis({ records, settings, module, setModule, onEdit }: { records: TrainingRecord[]; settings: Settings; module: ModuleName; setModule: (module: ModuleName) => void; onEdit: (record: TrainingRecord) => void }) {
  const detail = moduleDetail(records, module, settings);
  const modules = MODULES.filter((item) => item.name !== "全模块测试");
  return (
    <div className="stack">
      <div className="module-tabs">
        {modules.map((item) => (
          <button key={item.id} className={module === item.name ? "active" : ""} onClick={() => setModule(item.name)}>
            {item.short}
            <span>{moduleDetail(records, item.name, settings).total ? `${moduleDetail(records, item.name, settings).rate}%` : "--"}</span>
          </button>
        ))}
      </div>
      <section className="grid-two">
        <Panel title={`${module}概况`}>
          <div className="diagnosis-head" style={{ "--accent": accent(module) } as React.CSSProperties}>
            <strong>{detail.total ? `${detail.rate}%` : "待建立"}</strong>
            <span>{detail.total} 题 · {Math.max(0, detail.total - detail.correct)} 错 · {detail.pending} 条复盘</span>
          </div>
          <ul className="advice">{detail.actions.map((item) => <li key={item}>{item}</li>)}</ul>
        </Panel>
        <Panel title="错因分布">
          <Bars rows={detail.reasons.map((item) => ({ name: item.name, value: item.value }))} empty="暂无错因数据" />
        </Panel>
      </section>
      <section className="grid-two">
        <Panel title="题型弱项">
          <Bars rows={detail.subTypes.map((item) => ({ name: item.name, value: 100 - item.rate, hint: `${item.rate}% · 错 ${item.wrong}` }))} empty="暂无题型数据" />
        </Panel>
        <Panel title="最近记录">
          <div className="record-list compact">
            {detail.rows.slice(0, 5).map((item) => <RecordCard key={item.id} record={item} onEdit={onEdit} />)}
            {!detail.rows.length && <Empty text="还没有这个模块的记录。" />}
          </div>
        </Panel>
      </section>
    </div>
  );
}

function Review({ records, onDone, onEdit, onDelete }: { records: TrainingRecord[]; onDone: (record: TrainingRecord) => void; onEdit: (record: TrainingRecord) => void; onDelete: (record: TrainingRecord) => void }) {
  return (
    <Panel title="复盘队列">
      <div className="record-list">
        {records.map((item) => <RecordCard key={item.id} record={item} onEdit={onEdit} onDelete={onDelete} action={<button className="primary-btn" onClick={() => onDone(item)}><CheckCircle2 /> 完成</button>} />)}
        {!records.length && <Empty text="当前没有待复盘记录。" />}
      </div>
    </Panel>
  );
}

function Ledger({ records, query, module, onQuery, onModule, onEdit, onDelete }: {
  records: TrainingRecord[];
  query: string;
  module: ModuleName | "全部";
  onQuery: (value: string) => void;
  onModule: (value: ModuleName | "全部") => void;
  onEdit: (record: TrainingRecord) => void;
  onDelete: (record: TrainingRecord) => void;
}) {
  return (
    <div className="stack">
      <section className="toolbar">
        <div className="search">
          <Search />
          <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="搜索日期、模块、错因、标签、备注" />
        </div>
        <select value={module} onChange={(e) => onModule(e.target.value as ModuleName | "全部")}>
          <option>全部</option>
          {MODULES.map((item) => <option key={item.id}>{item.name}</option>)}
        </select>
      </section>
      <Panel title="训练台账">
        <div className="table-wrap">
          <table>
            <thead><tr><th>日期</th><th>模块</th><th>题型</th><th>正确率</th><th>节奏</th><th>错因</th><th>标签</th><th>操作</th></tr></thead>
            <tbody>
              {records.map((item) => (
                <tr key={item.id}>
                  <td>{item.date}</td>
                  <td>{item.module}</td>
                  <td>{item.subType}</td>
                  <td><strong>{percent(item.correct, item.total)}%</strong><small>{item.correct}/{item.total}</small></td>
                  <td>{paceLabel(item)}</td>
                  <td>{item.errorReason}</td>
                  <td>{item.tags.length ? item.tags.join(" / ") : "--"}</td>
                  <td><button className="icon-btn" onClick={() => onEdit(item)}><Edit3 /></button><button className="icon-btn danger" onClick={() => onDelete(item)}><Trash2 /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
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
            <Field label="考试日期"><input type="date" value={settings.examDate} onChange={(e) => setSettings({ ...settings, examDate: e.target.value })} /></Field>
            <Field label="每日目标"><input inputMode="numeric" value={settings.dailyGoal} onChange={(e) => setSettings({ ...settings, dailyGoal: Number(e.target.value) || DEFAULT_SETTINGS.dailyGoal })} /></Field>
            <Field label="目标正确率"><input inputMode="numeric" value={settings.targetRate} onChange={(e) => setSettings({ ...settings, targetRate: Number(e.target.value) || DEFAULT_SETTINGS.targetRate })} /></Field>
          </div>
        </Panel>
        <Panel title="空间码">
          <div className="sync-line"><SyncIcon state={syncState} /><strong>{syncLabel(syncState)}</strong><span>{lastSync || "自动保存与拉取"}</span></div>
          <div className="space-row">
            <input value={draft} onChange={(e) => setDraft(normalizeCode(e.target.value))} placeholder="输入或生成空间码" />
            <button className="primary-btn" onClick={() => setSpaceCode(draft)}><Save /> 保存</button>
          </div>
          <div className="button-row">
            <button className="soft-btn" onClick={onGenerate}><Wand2 /> 生成</button>
            <button className="soft-btn" onClick={onSync} disabled={!spaceCode}><RefreshCw /> 同步</button>
            <button className="soft-btn danger-text" onClick={onClear} disabled={!spaceCode}><CloudOff /> 清除</button>
          </div>
        </Panel>
      </section>
      <Panel title="备份">
        <div className="button-row">
          <button className="soft-btn" onClick={onExportJson}><Download /> JSON</button>
          <button className="soft-btn" onClick={onExportCsv}><Download /> CSV</button>
          <label className="soft-btn file-btn"><Upload /> 导入<input type="file" accept="application/json,.json" onChange={(e) => onImport(e.target.files?.[0])} /></label>
        </div>
      </Panel>
    </div>
  );
}

function Metric({ label, value, unit, icon }: { label: string; value: ReactNode; unit: string; icon: ReactNode }) {
  return <motion.div className="metric" whileHover={{ y: -3 }}><div><span>{label}</span><strong>{value}</strong><small>{unit}</small></div>{icon}</motion.div>;
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <section className="panel"><div className="panel-head"><h3>{title}</h3></div>{children}</section>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function RecordCard({ record, onEdit, onDelete, action }: { record: TrainingRecord; onEdit: (record: TrainingRecord) => void; onDelete?: (record: TrainingRecord) => void; action?: ReactNode }) {
  const wrong = Math.max(0, record.total - record.correct);
  return (
    <article className="record-card">
      <i style={{ background: accent(record.module) }} />
      <div>
        <strong>{record.module} · {record.subType}</strong>
        <span>{record.date} · {record.correct}/{record.total} · 错 {wrong} · {record.errorReason}</span>
        {record.tags.length > 0 && <small>{record.tags.join(" / ")}</small>}
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
  return <div className="bars">{rows.map((item) => <div key={item.name}><span>{item.name}</span><i><b style={{ width: `${Math.max(6, (item.value / max) * 100)}%` }} /></i><strong>{item.hint || item.value}</strong></div>)}</div>;
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
  return { local: "本机保存", syncing: "同步中", synced: "已同步", offline: "离线待同步", error: "同步异常" }[state];
}

function formatTimer(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
