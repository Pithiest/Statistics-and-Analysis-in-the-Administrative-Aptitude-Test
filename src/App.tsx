import { AnimatePresence, motion } from "framer-motion";
import { del, get, set } from "idb-keyval";
import {
  Activity,
  BadgeCheck,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Cloud,
  CloudOff,
  Database,
  Download,
  Gauge,
  LayoutDashboard,
  LogOut,
  Moon,
  Plus,
  Radar,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  SquarePen,
  Sun,
  Table2,
  TimerReset,
  Trash2,
  Upload,
  UserRound
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  Radar as RadarShape,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { createClient, Session } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://atwsraivphybkfmyeubd.supabase.co";
const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_y6wlba5S8qYJebIgnc389Q_zW6pMJnv";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const LOCAL_RECORDS = "xingce_react_records_v1";
const LOCAL_SETTINGS = "xingce_react_settings_v1";
const MIGRATION_DONE = "xingce_react_legacy_migrated";

type View = "overview" | "entry" | "diagnosis" | "ledger" | "account";
type Theme = "light" | "dark";
type SyncStatus = "local" | "syncing" | "synced" | "offline" | "error";

type TrainingRecord = {
  id: string;
  date: string;
  module: string;
  subType: string;
  total: number;
  correct: number;
  duration: number;
  errorReason: string;
  note: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

type RemoteRecord = {
  id: string;
  user_id: string;
  date: string;
  module: string;
  sub_type: string;
  total: number;
  correct: number;
  duration: number | string;
  error_reason: string;
  note: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
};

type AppSettings = {
  examDate: string;
  dailyGoal: number;
  targetRate: number;
  theme: Theme;
  updatedAt: string;
};

type EntryForm = {
  date: string;
  module: string;
  subType: string;
  total: string;
  correct: string;
  duration: string;
  errorReason: string;
  note: string;
};

const MODULES = {
  "言语理解与表达": {
    short: "言语",
    color: "#4f46e5",
    speed: 50,
    subs: ["逻辑填空", "中心理解", "细节判断", "语句表达", "篇章阅读", "综合卷/混刷"]
  },
  判断推理: {
    short: "判断",
    color: "#0f766e",
    speed: 52.5,
    subs: ["图形推理", "定义判断", "类比推理", "逻辑判断", "综合卷/混刷"]
  },
  资料分析: {
    short: "资料",
    color: "#2563eb",
    speed: 60,
    subs: ["文字资料", "表格资料", "图形资料", "综合卷/混刷"]
  },
  数量关系: {
    short: "数量",
    color: "#be123c",
    speed: 90,
    subs: ["工程问题", "行程问题", "经济利润", "排列组合", "几何问题", "综合卷/混刷"]
  },
  常识判断: {
    short: "常识",
    color: "#b45309",
    speed: 45,
    subs: ["政治理论", "法律常识", "科技人文", "经济管理", "综合卷/混刷"]
  }
} as const;

const MODULE_NAMES = Object.keys(MODULES);
const REASONS = ["无", "粗心看错", "时间紧迫", "知识盲区", "方法不熟", "逻辑掉坑"];
const QUICK_PICKS = [
  { name: "言语 20", module: "言语理解与表达", total: 20, duration: 18 },
  { name: "判断 20", module: "判断推理", total: 20, duration: 18 },
  { name: "资料 15", module: "资料分析", total: 15, duration: 15 },
  { name: "数量 10", module: "数量关系", total: 10, duration: 15 },
  { name: "常识 20", module: "常识判断", total: 20, duration: 15 },
  { name: "全套 100", module: "言语理解与表达", total: 100, duration: 120 }
];

const defaultSettings: AppSettings = {
  examDate: "",
  dailyGoal: 80,
  targetRate: 80,
  theme: "light",
  updatedAt: new Date().toISOString()
};

const emptyForm = (): EntryForm => ({
  date: today(),
  module: MODULE_NAMES[0],
  subType: MODULES["言语理解与表达"].subs[5],
  total: "20",
  correct: "",
  duration: "18",
  errorReason: "无",
  note: ""
});

export function App() {
  const [records, setRecords] = useState<TrainingRecord[]>([]);
  const [settings, setSettingsState] = useState<AppSettings>(defaultSettings);
  const [activeView, setActiveView] = useState<View>("overview");
  const [session, setSession] = useState<Session | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("local");
  const [lastSync, setLastSync] = useState("");
  const [toast, setToast] = useState("");
  const [booting, setBooting] = useState(true);
  const [legacyCount, setLegacyCount] = useState(0);
  const [syncTick, setSyncTick] = useState(0);
  const [form, setForm] = useState<EntryForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [ledgerModule, setLedgerModule] = useState("全部");
  const [diagnosisModule, setDiagnosisModule] = useState(MODULE_NAMES[0]);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [timerMs, setTimerMs] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const timerStarted = useRef(0);
  const timerBase = useRef(0);
  const recordsRef = useRef(records);
  const settingsRef = useRef(settings);

  const visibleRecords = useMemo(
    () => records.filter((record) => !record.deletedAt).sort((a, b) => b.date.localeCompare(a.date)),
    [records]
  );
  const stats = useMemo(() => makeStats(visibleRecords, settings), [visibleRecords, settings]);
  const trend = useMemo(() => makeTrend(visibleRecords, 14), [visibleRecords]);
  const moduleStats = useMemo(() => makeModuleStats(visibleRecords), [visibleRecords]);
  const reasonStats = useMemo(() => makeReasonStats(visibleRecords), [visibleRecords]);
  const filteredLedger = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return visibleRecords.filter((record) => {
      const moduleOk = ledgerModule === "全部" || record.module === ledgerModule;
      const queryOk =
        !normalizedQuery ||
        [record.module, record.subType, record.errorReason, record.note].join(" ").toLowerCase().includes(normalizedQuery);
      return moduleOk && queryOk;
    });
  }, [ledgerModule, query, visibleRecords]);

  useEffect(() => {
    recordsRef.current = records;
  }, [records]);

  useEffect(() => {
    settingsRef.current = settings;
    document.documentElement.dataset.theme = settings.theme;
  }, [settings]);

  useEffect(() => {
    let mounted = true;
    async function boot() {
      const [storedRecords, storedSettings, migrated, auth] = await Promise.all([
        get<TrainingRecord[]>(LOCAL_RECORDS),
        get<AppSettings>(LOCAL_SETTINGS),
        get<boolean>(MIGRATION_DONE),
        supabase.auth.getSession()
      ]);
      if (!mounted) return;
      const localRecords = Array.isArray(storedRecords) ? storedRecords : [];
      const localSettings = storedSettings ? { ...defaultSettings, ...storedSettings } : defaultSettings;
      setRecords(localRecords);
      setSettingsState(localSettings);
      setSession(auth.data.session ?? null);
      if (!migrated) setLegacyCount(loadLegacyRecords().length);
      setBooting(false);
    }
    boot();
    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession) void pullRemote(nextSession);
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session || syncTick === 0) return;
    const id = window.setTimeout(() => void pushRemote(), 800);
    return () => window.clearTimeout(id);
  }, [session, syncTick]);

  useEffect(() => {
    if (!session) return;
    const interval = window.setInterval(() => void pullRemote(session), 20000);
    const onFocus = () => void pullRemote(session);
    const onOnline = () => {
      setSyncStatus("syncing");
      void pushRemote().then(() => pullRemote(session));
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
    };
  }, [session]);

  useEffect(() => {
    if (!timerRunning) return;
    const id = window.setInterval(() => {
      setTimerMs(timerBase.current + Date.now() - timerStarted.current);
    }, 250);
    return () => window.clearInterval(id);
  }, [timerRunning]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  }

  async function commitRecords(next: TrainingRecord[], dirty = true) {
    const normalized = normalizeRecords(next);
    recordsRef.current = normalized;
    setRecords(normalized);
    await set(LOCAL_RECORDS, normalized);
    if (dirty) {
      setSyncStatus(session ? "syncing" : "local");
      setSyncTick((value) => value + 1);
    }
  }

  async function commitSettings(next: AppSettings, dirty = true) {
    const normalized = { ...next, updatedAt: next.updatedAt || new Date().toISOString() };
    settingsRef.current = normalized;
    setSettingsState(normalized);
    await set(LOCAL_SETTINGS, normalized);
    if (dirty) {
      setSyncStatus(session ? "syncing" : "local");
      setSyncTick((value) => value + 1);
    }
  }

  async function pushRemote() {
    if (!session) return;
    if (!navigator.onLine) {
      setSyncStatus("offline");
      return;
    }
    try {
      setSyncStatus("syncing");
      const rows = recordsRef.current.map((record) => toRemoteRecord(record, session.user.id));
      if (rows.length) {
        const { error } = await supabase.from("training_records").upsert(rows, { onConflict: "id" });
        if (error) throw error;
      }
      const { error: settingsError } = await supabase.from("user_settings").upsert({
        user_id: session.user.id,
        exam_date: settingsRef.current.examDate || null,
        daily_goal: settingsRef.current.dailyGoal,
        target_rate: settingsRef.current.targetRate,
        theme: settingsRef.current.theme,
        updated_at: settingsRef.current.updatedAt
      });
      if (settingsError) throw settingsError;
      setSyncStatus("synced");
      setLastSync(new Date().toLocaleTimeString());
    } catch (error) {
      console.error(error);
      setSyncStatus("error");
    }
  }

  async function pullRemote(currentSession = session) {
    if (!currentSession || !navigator.onLine) return;
    try {
      setSyncStatus("syncing");
      const [{ data: remoteRecords, error }, { data: remoteSettings, error: settingsError }] = await Promise.all([
        supabase
          .from("training_records")
          .select("*")
          .eq("user_id", currentSession.user.id)
          .order("updated_at", { ascending: false }),
        supabase.from("user_settings").select("*").eq("user_id", currentSession.user.id).maybeSingle()
      ]);
      if (error) throw error;
      if (settingsError) throw settingsError;
      const merged = mergeRecords(recordsRef.current, (remoteRecords || []).map(fromRemoteRecord));
      await commitRecords(merged, false);
      if (remoteSettings) {
        const remote = {
          examDate: remoteSettings.exam_date || "",
          dailyGoal: remoteSettings.daily_goal || 80,
          targetRate: remoteSettings.target_rate || 80,
          theme: remoteSettings.theme === "dark" ? "dark" : "light",
          updatedAt: remoteSettings.updated_at
        } satisfies AppSettings;
        if (new Date(remote.updatedAt).getTime() >= new Date(settingsRef.current.updatedAt).getTime()) {
          await commitSettings(remote, false);
        }
      }
      setSyncStatus("synced");
      setLastSync(new Date().toLocaleTimeString());
    } catch (error) {
      console.error(error);
      setSyncStatus("error");
    }
  }

  async function sendOtp(event: FormEvent) {
    event.preventDefault();
    setAuthMessage("正在发送验证码...");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin }
    });
    setAuthMessage(error ? `发送失败：${error.message}` : "验证码或登录链接已发送，请查收邮箱。");
  }

  async function verifyOtp(event: FormEvent) {
    event.preventDefault();
    const { error } = await supabase.auth.verifyOtp({ email, token: otp, type: "email" });
    setAuthMessage(error ? `验证失败：${error.message}` : "登录成功，正在同步数据。");
  }

  async function signOut() {
    await supabase.auth.signOut();
    setSession(null);
    setSyncStatus("local");
    notify("已退出账号，本机数据仍然保留");
  }

  async function migrateLegacy() {
    const legacy = loadLegacyRecords();
    if (!legacy.length) return;
    const now = new Date().toISOString();
    const migrated = legacy.map((record: Record<string, unknown>) =>
      normalizeRecord({
        id: crypto.randomUUID(),
        date: record.date,
        module: normalizeModule(String(record.module || "")),
        subType: record.subType || record.sub_type || "综合卷/混刷",
        total: record.total,
        correct: record.correct,
        duration: record.duration,
        errorReason: record.errorReason || record.error_reason || "无",
        note: record.note || "",
        createdAt: record.createdAt || record.created_at || now,
        updatedAt: record.updatedAt || record.updated_at || now
      })
    );
    await commitRecords(mergeRecords(recordsRef.current, migrated.filter(Boolean) as TrainingRecord[]), true);
    await set(MIGRATION_DONE, true);
    setLegacyCount(0);
    notify("旧数据已迁移到新版");
  }

  function saveRecord(keepForm = false) {
    const record = normalizeRecord({
      id: editingId || crypto.randomUUID(),
      date: form.date,
      module: form.module,
      subType: form.subType,
      total: form.total,
      correct: form.correct,
      duration: form.duration,
      errorReason: form.errorReason,
      note: form.note,
      createdAt: editingId ? records.find((item) => item.id === editingId)?.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    if (!record) {
      notify("请检查题量、正确数和耗时");
      return;
    }
    const next = editingId
      ? records.map((item) => (item.id === editingId ? record : item))
      : [record, ...records];
    void commitRecords(next, true);
    notify(editingId ? "记录已更新，稍后自动同步" : "记录已保存，稍后自动同步");
    setEditingId(null);
    if (keepForm) {
      setForm((prev) => ({ ...prev, correct: "", note: "" }));
    } else {
      setForm(emptyForm());
      setActiveView("overview");
    }
  }

  function editRecord(record: TrainingRecord) {
    setForm({
      date: record.date,
      module: record.module,
      subType: record.subType,
      total: String(record.total),
      correct: String(record.correct),
      duration: String(record.duration),
      errorReason: record.errorReason,
      note: record.note
    });
    setEditingId(record.id);
    setActiveView("entry");
  }

  function deleteRecord(record: TrainingRecord) {
    if (!window.confirm("确定删除这条记录吗？登录后会自动同步删除。")) return;
    const now = new Date().toISOString();
    void commitRecords(
      records.map((item) => (item.id === record.id ? { ...item, deletedAt: now, updatedAt: now } : item)),
      true
    );
    notify("记录已删除");
  }

  function applyQuickPick(pick: (typeof QUICK_PICKS)[number]) {
    setForm({
      ...emptyForm(),
      module: pick.module,
      subType: lastSubType(pick.module),
      total: String(pick.total),
      duration: String(pick.duration)
    });
    setActiveView("entry");
  }

  function toggleTimer() {
    if (timerRunning) {
      timerBase.current = timerMs;
      setTimerRunning(false);
      const minutes = Math.max(1, Math.round((timerMs / 60000) * 10) / 10);
      setForm((prev) => ({ ...prev, duration: String(minutes) }));
      return;
    }
    timerStarted.current = Date.now();
    timerBase.current = timerMs;
    setTimerRunning(true);
  }

  function resetTimer() {
    timerBase.current = 0;
    timerStarted.current = 0;
    setTimerRunning(false);
    setTimerMs(0);
  }

  async function exportJson() {
    download(
      `行测训练备份_${today()}.json`,
      JSON.stringify({ version: 30, exportedAt: new Date().toISOString(), settings, records: visibleRecords }, null, 2),
      "application/json;charset=utf-8"
    );
  }

  function exportCsv() {
    const header = ["日期", "模块", "题型", "总题", "正确", "正确率", "耗时", "配速", "错因", "笔记"];
    const body = filteredLedger.map((record) => [
      record.date,
      record.module,
      record.subType,
      record.total,
      record.correct,
      `${rate(record.correct, record.total)}%`,
      record.duration,
      `${pace(record)}s/题`,
      record.errorReason,
      record.note
    ]);
    const csv = "\uFEFF" + [header, ...body].map((row) => row.map(csvCell).join(",")).join("\n");
    download(`行测台账_${today()}.csv`, csv, "text/csv;charset=utf-8");
  }

  function importJson(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const parsed = safeParse(String(reader.result));
      const imported = Array.isArray(parsed) ? parsed : parsed?.records;
      if (!Array.isArray(imported)) {
        notify("JSON 格式无法识别");
        return;
      }
      const now = new Date().toISOString();
      const next = imported
        .map((item: Record<string, unknown>) =>
          normalizeRecord({
            id: typeof item.id === "string" && isUuid(item.id) ? item.id : crypto.randomUUID(),
            date: item.date,
            module: normalizeModule(String(item.module || "")),
            subType: item.subType || item.sub_type || "综合卷/混刷",
            total: item.total,
            correct: item.correct,
            duration: item.duration,
            errorReason: item.errorReason || item.error_reason || "无",
            note: item.note || "",
            createdAt: item.createdAt || item.created_at || now,
            updatedAt: item.updatedAt || item.updated_at || now
          })
        )
        .filter(Boolean) as TrainingRecord[];
      await commitRecords(mergeRecords(recordsRef.current, next), true);
      notify("JSON 已导入并等待自动同步");
    };
    reader.readAsText(file, "utf-8");
  }

  if (booting) {
    return (
      <div className="boot">
        <Sparkles />
        <span>正在启动训练驾驶舱</span>
      </div>
    );
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">行</div>
          <div>
            <strong>行测训练驾驶舱</strong>
            <span>{session ? "账号自动同步" : "本机优先保存"}</span>
          </div>
        </div>
        <nav className="nav">
          <NavButton active={activeView === "overview"} icon={<LayoutDashboard />} label="总览" onClick={() => setActiveView("overview")} />
          <NavButton active={activeView === "entry"} icon={<SquarePen />} label="录入" onClick={() => setActiveView("entry")} />
          <NavButton active={activeView === "diagnosis"} icon={<Activity />} label="诊断" onClick={() => setActiveView("diagnosis")} />
          <NavButton active={activeView === "ledger"} icon={<Table2 />} label="台账" onClick={() => setActiveView("ledger")} />
          <NavButton active={activeView === "account"} icon={<UserRound />} label="账户" onClick={() => setActiveView("account")} />
        </nav>
        <div className="sync-card">
          <SyncIcon status={syncStatus} />
          <div>
            <strong>{syncLabel(syncStatus)}</strong>
            <span>{lastSync ? `最近同步 ${lastSync}` : session ? "登录后自动同步" : "登录可跨设备同步"}</span>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">Training Intelligence</p>
            <h1>{viewTitle(activeView)}</h1>
          </div>
          <div className="top-actions">
            <button className="icon-btn" onClick={() => commitSettings({ ...settings, theme: settings.theme === "dark" ? "light" : "dark", updatedAt: new Date().toISOString() })}>
              {settings.theme === "dark" ? <Sun /> : <Moon />}
            </button>
            <button className="btn" onClick={() => setActiveView("account")}>
              <ShieldCheck /> {session ? "已登录" : "登录同步"}
            </button>
            <button className="btn primary" onClick={() => setActiveView("entry")}>
              <Plus /> 新增记录
            </button>
          </div>
        </header>

        <AnimatePresence mode="wait">
          <motion.section
            key={activeView}
            className="view"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.22 }}
          >
            {activeView === "overview" && (
              <Overview
                stats={stats}
                trend={trend}
                moduleStats={moduleStats}
                reasonStats={reasonStats}
                records={visibleRecords}
                settings={settings}
                legacyCount={legacyCount}
                onMigrate={migrateLegacy}
                onQuickPick={applyQuickPick}
              />
            )}
            {activeView === "entry" && (
              <EntryView
                form={form}
                setForm={setForm}
                editingId={editingId}
                timerMs={timerMs}
                timerRunning={timerRunning}
                onTimer={toggleTimer}
                onTimerReset={resetTimer}
                onSave={() => saveRecord(false)}
                onSaveNext={() => saveRecord(true)}
                onCancel={() => {
                  setEditingId(null);
                  setForm(emptyForm());
                }}
                onQuickPick={applyQuickPick}
              />
            )}
            {activeView === "diagnosis" && (
              <DiagnosisView
                moduleName={diagnosisModule}
                setModuleName={setDiagnosisModule}
                records={visibleRecords}
                settings={settings}
              />
            )}
            {activeView === "ledger" && (
              <LedgerView
                records={filteredLedger}
                query={query}
                setQuery={setQuery}
                moduleName={ledgerModule}
                setModuleName={setLedgerModule}
                onEdit={editRecord}
                onDelete={deleteRecord}
                onExportCsv={exportCsv}
              />
            )}
            {activeView === "account" && (
              <AccountView
                session={session}
                email={email}
                setEmail={setEmail}
                otp={otp}
                setOtp={setOtp}
                authMessage={authMessage}
                settings={settings}
                setSettings={commitSettings}
                syncStatus={syncStatus}
                legacyCount={legacyCount}
                onSendOtp={sendOtp}
                onVerifyOtp={verifyOtp}
                onSignOut={signOut}
                onPull={() => session && pullRemote(session)}
                onPush={pushRemote}
                onMigrate={migrateLegacy}
                onExportJson={exportJson}
                onImportJson={importJson}
              />
            )}
          </motion.section>
        </AnimatePresence>
      </main>

      <nav className="mobile-nav">
        <NavButton compact active={activeView === "overview"} icon={<LayoutDashboard />} label="总览" onClick={() => setActiveView("overview")} />
        <NavButton compact active={activeView === "entry"} icon={<SquarePen />} label="录入" onClick={() => setActiveView("entry")} />
        <NavButton compact active={activeView === "diagnosis"} icon={<Activity />} label="诊断" onClick={() => setActiveView("diagnosis")} />
        <NavButton compact active={activeView === "ledger"} icon={<Table2 />} label="台账" onClick={() => setActiveView("ledger")} />
        <NavButton compact active={activeView === "account"} icon={<UserRound />} label="账户" onClick={() => setActiveView("account")} />
      </nav>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function Overview({
  stats,
  trend,
  moduleStats,
  reasonStats,
  records,
  settings,
  legacyCount,
  onMigrate,
  onQuickPick
}: {
  stats: ReturnType<typeof makeStats>;
  trend: ReturnType<typeof makeTrend>;
  moduleStats: ReturnType<typeof makeModuleStats>;
  reasonStats: ReturnType<typeof makeReasonStats>;
  records: TrainingRecord[];
  settings: AppSettings;
  legacyCount: number;
  onMigrate: () => void;
  onQuickPick: (pick: (typeof QUICK_PICKS)[number]) => void;
}) {
  return (
    <div className="grid">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Today Focus</p>
          <h2>{makeHeadline(stats)}</h2>
          <p>用题量、正确率、配速和错因把复盘压缩到一屏里。新版会自动同步，不再手动上传拉取。</p>
        </div>
        <div className="hero-orbit">
          <Gauge />
          <strong>{stats.allRate}%</strong>
          <span>全局正确率</span>
        </div>
      </section>

      {legacyCount > 0 && (
        <section className="notice">
          <Database />
          <div>
            <strong>检测到 {legacyCount} 条旧版本机数据</strong>
            <span>登录后建议迁移到新版账号同步。</span>
          </div>
          <button className="btn primary" onClick={onMigrate}>迁移旧数据</button>
        </section>
      )}

      <section className="metric-grid">
        <Metric label="今日刷题" value={stats.todayTotal} unit="题" icon={<CalendarClock />} />
        <Metric label="今日正确率" value={`${stats.todayRate}%`} unit={`目标 ${settings.targetRate}%`} icon={<BadgeCheck />} />
        <Metric label="近 7 天题量" value={stats.weekTotal} unit="题" icon={<BarChart3 />} />
        <Metric label="连续训练" value={stats.streak} unit="天" icon={<Sparkles />} />
        <Metric label="累计题量" value={stats.allTotal} unit="题" icon={<Database />} />
        <Metric label="平均配速" value={`${stats.avgPace}s`} unit="每题" icon={<TimerReset />} />
      </section>

      <section className="split">
        <Card title="训练趋势" action="14 天">
          <ChartBox>
            <LineChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tickLine={false} axisLine={false} />
              <YAxis yAxisId="left" tickLine={false} axisLine={false} />
              <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tickLine={false} axisLine={false} />
              <Tooltip />
              <Line yAxisId="left" type="monotone" dataKey="total" stroke="#2563eb" strokeWidth={3} dot={false} name="题量" />
              <Line yAxisId="right" type="monotone" dataKey="rate" stroke="#0f766e" strokeWidth={3} dot={false} name="正确率" />
            </LineChart>
          </ChartBox>
        </Card>
        <Card title="模块雷达" action="强弱项">
          <ChartBox>
            <RadarChart data={moduleStats}>
              <PolarGrid />
              <PolarAngleAxis dataKey="short" />
              <Tooltip />
              <RadarShape dataKey="rate" stroke="#4f46e5" fill="#4f46e5" fillOpacity={0.25} name="正确率" />
            </RadarChart>
          </ChartBox>
        </Card>
      </section>

      <section className="split">
        <Card title="快捷训练">
          <div className="quick-grid">
            {QUICK_PICKS.map((pick) => (
              <button key={pick.name} className="quick-card" onClick={() => onQuickPick(pick)}>
                <strong>{pick.name}</strong>
                <span>{pick.duration} 分钟模板</span>
              </button>
            ))}
          </div>
        </Card>
        <Card title="智能复盘建议" action="自动生成">
          <div className="insight-list">
            {makeInsights(records, moduleStats, reasonStats).map((item) => (
              <div className="insight" key={item.title}>
                <Radar />
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.text}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </section>
    </div>
  );
}

function EntryView({
  form,
  setForm,
  editingId,
  timerMs,
  timerRunning,
  onTimer,
  onTimerReset,
  onSave,
  onSaveNext,
  onCancel,
  onQuickPick
}: {
  form: EntryForm;
  setForm: (form: EntryForm | ((prev: EntryForm) => EntryForm)) => void;
  editingId: string | null;
  timerMs: number;
  timerRunning: boolean;
  onTimer: () => void;
  onTimerReset: () => void;
  onSave: () => void;
  onSaveNext: () => void;
  onCancel: () => void;
  onQuickPick: (pick: (typeof QUICK_PICKS)[number]) => void;
}) {
  const module = MODULES[form.module as keyof typeof MODULES];
  return (
    <div className="entry-layout">
      <Card title={editingId ? "修改训练记录" : "快速录入"} action="本地秒存">
        <div className="form-grid">
          <Field label="日期">
            <input value={form.date} type="date" onChange={(event) => setForm((p) => ({ ...p, date: event.target.value }))} />
          </Field>
          <Field label="模块">
            <select
              value={form.module}
              onChange={(event) => {
                const next = event.target.value;
                setForm((p) => ({ ...p, module: next, subType: lastSubType(next) }));
              }}
            >
              {MODULE_NAMES.map((name) => <option key={name}>{name}</option>)}
            </select>
          </Field>
          <Field label="题型">
            <select value={form.subType} onChange={(event) => setForm((p) => ({ ...p, subType: event.target.value }))}>
              {module.subs.map((name) => <option key={name}>{name}</option>)}
            </select>
          </Field>
          <Field label="总题">
            <input value={form.total} inputMode="numeric" onChange={(event) => setForm((p) => ({ ...p, total: event.target.value }))} />
          </Field>
          <Field label="正确">
            <input value={form.correct} inputMode="numeric" onChange={(event) => setForm((p) => ({ ...p, correct: event.target.value }))} />
          </Field>
          <Field label="耗时（分钟）">
            <input value={form.duration} inputMode="decimal" onChange={(event) => setForm((p) => ({ ...p, duration: event.target.value }))} />
          </Field>
        </div>
        <div className="reason-row">
          {REASONS.map((reason) => (
            <button
              key={reason}
              className={form.errorReason === reason ? "chip active" : "chip"}
              onClick={() => setForm((p) => ({ ...p, errorReason: reason }))}
            >
              {reason}
            </button>
          ))}
        </div>
        <Field label="复盘笔记">
          <textarea value={form.note} placeholder="比如：资料分析比重题二次定位慢；判断推理定义题漏条件。" onChange={(event) => setForm((p) => ({ ...p, note: event.target.value }))} />
        </Field>
        <div className="action-row">
          <button className="btn primary" onClick={onSave}><Save />保存记录</button>
          <button className="btn" onClick={onSaveNext}>保存并继续</button>
          {editingId && <button className="btn ghost" onClick={onCancel}>取消修改</button>}
        </div>
      </Card>
      <div className="side-stack">
        <Card title="训练计时器">
          <div className="timer-face">
            <strong>{formatTimer(timerMs)}</strong>
            <span>结束后自动填入耗时</span>
          </div>
          <div className="action-row">
            <button className="btn primary" onClick={onTimer}>{timerRunning ? "暂停" : "开始"}</button>
            <button className="btn" onClick={onTimerReset}><TimerReset />归零</button>
          </div>
        </Card>
        <Card title="快捷模板">
          <div className="quick-grid compact">
            {QUICK_PICKS.map((pick) => (
              <button key={pick.name} className="quick-card" onClick={() => onQuickPick(pick)}>
                <strong>{pick.name}</strong>
                <span>{pick.duration} min</span>
              </button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function DiagnosisView({
  moduleName,
  setModuleName,
  records,
  settings
}: {
  moduleName: string;
  setModuleName: (value: string) => void;
  records: TrainingRecord[];
  settings: AppSettings;
}) {
  const scoped = records.filter((record) => record.module === moduleName);
  const subtypeStats = makeSubtypeStats(scoped);
  const reasonStats = makeReasonStats(scoped);
  return (
    <div className="grid">
      <section className="toolbar-panel">
        <div>
          <p className="eyebrow">Module Lab</p>
          <h2>{moduleName}</h2>
        </div>
        <select value={moduleName} onChange={(event) => setModuleName(event.target.value)}>
          {MODULE_NAMES.map((name) => <option key={name}>{name}</option>)}
        </select>
      </section>
      <section className="split">
        <Card title="题型表现">
          <ChartBox>
            <BarChart data={subtypeStats}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tickLine={false} axisLine={false} />
              <YAxis domain={[0, 100]} tickLine={false} axisLine={false} />
              <Tooltip />
              <Bar dataKey="rate" radius={[8, 8, 0, 0]} name="正确率">
                {subtypeStats.map((item) => <Cell key={item.name} fill={item.rate >= settings.targetRate ? "#0f766e" : "#be123c"} />)}
              </Bar>
            </BarChart>
          </ChartBox>
        </Card>
        <Card title="错因结构">
          <ChartBox>
            <PieChart>
              <Tooltip />
              <Pie data={reasonStats} dataKey="value" nameKey="name" innerRadius={58} outerRadius={96} paddingAngle={4}>
                {reasonStats.map((item, index) => <Cell key={item.name} fill={["#2563eb", "#0f766e", "#b45309", "#be123c", "#4f46e5", "#64748b"][index % 6]} />)}
              </Pie>
            </PieChart>
          </ChartBox>
        </Card>
      </section>
      <Card title="近期记录">
        <RecordList records={scoped.slice(0, 6)} />
      </Card>
    </div>
  );
}

function LedgerView({
  records,
  query,
  setQuery,
  moduleName,
  setModuleName,
  onEdit,
  onDelete,
  onExportCsv
}: {
  records: TrainingRecord[];
  query: string;
  setQuery: (value: string) => void;
  moduleName: string;
  setModuleName: (value: string) => void;
  onEdit: (record: TrainingRecord) => void;
  onDelete: (record: TrainingRecord) => void;
  onExportCsv: () => void;
}) {
  return (
    <div className="grid">
      <section className="toolbar-panel">
        <div className="search-box">
          <Search />
          <input value={query} placeholder="搜索模块、题型、错因、笔记" onChange={(event) => setQuery(event.target.value)} />
        </div>
        <select value={moduleName} onChange={(event) => setModuleName(event.target.value)}>
          <option>全部</option>
          {MODULE_NAMES.map((name) => <option key={name}>{name}</option>)}
        </select>
        <button className="btn" onClick={onExportCsv}><Download />导出 CSV</button>
      </section>
      <Card title={`训练台账 · ${records.length} 条`}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>日期</th>
                <th>模块</th>
                <th>题型</th>
                <th>正确率</th>
                <th>耗时</th>
                <th>错因</th>
                <th>笔记</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
                  <td>{record.date}</td>
                  <td>{MODULES[record.module as keyof typeof MODULES]?.short || record.module}</td>
                  <td>{record.subType}</td>
                  <td><span className={rateClass(record)}>{rate(record.correct, record.total)}%</span></td>
                  <td>{record.duration} 分</td>
                  <td>{record.errorReason}</td>
                  <td className="note-cell">{record.note || "—"}</td>
                  <td>
                    <button className="text-btn" onClick={() => onEdit(record)}>编辑</button>
                    <button className="text-btn danger" onClick={() => onDelete(record)}>删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function AccountView({
  session,
  email,
  setEmail,
  otp,
  setOtp,
  authMessage,
  settings,
  setSettings,
  syncStatus,
  legacyCount,
  onSendOtp,
  onVerifyOtp,
  onSignOut,
  onPull,
  onPush,
  onMigrate,
  onExportJson,
  onImportJson
}: {
  session: Session | null;
  email: string;
  setEmail: (value: string) => void;
  otp: string;
  setOtp: (value: string) => void;
  authMessage: string;
  settings: AppSettings;
  setSettings: (settings: AppSettings) => void;
  syncStatus: SyncStatus;
  legacyCount: number;
  onSendOtp: (event: FormEvent) => void;
  onVerifyOtp: (event: FormEvent) => void;
  onSignOut: () => void;
  onPull: () => void;
  onPush: () => void;
  onMigrate: () => void;
  onExportJson: () => void;
  onImportJson: (file: File | undefined) => void;
}) {
  return (
    <div className="account-grid">
      <Card title="账号同步" action={syncLabel(syncStatus)}>
        {session ? (
          <div className="account-card">
            <CheckCircle2 />
            <div>
              <strong>{session.user.email}</strong>
              <span>已登录。新增、修改、删除都会自动同步。</span>
            </div>
            <div className="action-row">
              <button className="btn" onClick={onPull}><RefreshCw />立即拉取</button>
              <button className="btn" onClick={onPush}><Cloud />立即上传</button>
              <button className="btn ghost" onClick={onSignOut}><LogOut />退出</button>
            </div>
          </div>
        ) : (
          <div className="login-grid">
            <form onSubmit={onSendOtp}>
              <Field label="邮箱">
                <input type="email" value={email} placeholder="your@email.com" onChange={(event) => setEmail(event.target.value)} required />
              </Field>
              <button className="btn primary"><ShieldCheck />发送验证码</button>
            </form>
            <form onSubmit={onVerifyOtp}>
              <Field label="邮箱验证码">
                <input value={otp} placeholder="6 位验证码" onChange={(event) => setOtp(event.target.value)} />
              </Field>
              <button className="btn">验证登录</button>
            </form>
            {authMessage && <p className="muted">{authMessage}</p>}
          </div>
        )}
      </Card>

      <Card title="目标设置">
        <div className="form-grid compact-form">
          <Field label="考试日期">
            <input
              type="date"
              value={settings.examDate}
              onChange={(event) => setSettings({ ...settings, examDate: event.target.value, updatedAt: new Date().toISOString() })}
            />
          </Field>
          <Field label="每日目标题量">
            <input
              inputMode="numeric"
              value={settings.dailyGoal}
              onChange={(event) => setSettings({ ...settings, dailyGoal: Math.max(1, Number(event.target.value) || 80), updatedAt: new Date().toISOString() })}
            />
          </Field>
          <Field label="目标正确率">
            <input
              inputMode="numeric"
              value={settings.targetRate}
              onChange={(event) => setSettings({ ...settings, targetRate: Math.min(100, Math.max(1, Number(event.target.value) || 80)), updatedAt: new Date().toISOString() })}
            />
          </Field>
        </div>
      </Card>

      <Card title="备份与迁移">
        <div className="action-row">
          <button className="btn" onClick={onExportJson}><Download />导出 JSON</button>
          <label className="btn file-btn">
            <Upload />导入 JSON
            <input type="file" accept="application/json,.json" onChange={(event) => onImportJson(event.target.files?.[0])} />
          </label>
          {legacyCount > 0 && <button className="btn primary" onClick={onMigrate}>迁移 {legacyCount} 条旧数据</button>}
        </div>
        <p className="muted">离线备份只做兜底；日常跨设备使用账号自动同步。</p>
      </Card>
    </div>
  );
}

function Card({ title, action, children }: { title: string; action?: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <div className="card-head">
        <h3>{title}</h3>
        {action && <span>{action}</span>}
      </div>
      {children}
    </section>
  );
}

function ChartBox({ children }: { children: React.ReactElement }) {
  return <div className="chart-box"><ResponsiveContainer>{children}</ResponsiveContainer></div>;
}

function Metric({ label, value, unit, icon }: { label: string; value: string | number; unit: string; icon: React.ReactNode }) {
  return (
    <motion.div className="metric" whileHover={{ y: -4 }}>
      <div className="metric-top"><span>{label}</span>{icon}</div>
      <strong>{value}</strong>
      <small>{unit}</small>
    </motion.div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function NavButton({ active, icon, label, compact, onClick }: { active: boolean; icon: React.ReactNode; label: string; compact?: boolean; onClick: () => void }) {
  return (
    <button className={`${compact ? "mobile-item" : "nav-item"} ${active ? "active" : ""}`} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function SyncIcon({ status }: { status: SyncStatus }) {
  if (status === "offline") return <CloudOff />;
  if (status === "syncing") return <RefreshCw className="spin" />;
  if (status === "error") return <CloudOff />;
  return <Cloud />;
}

function RecordList({ records }: { records: TrainingRecord[] }) {
  if (!records.length) return <p className="muted">暂无记录。</p>;
  return (
    <div className="record-list">
      {records.map((record) => (
        <div className="record-card" key={record.id}>
          <strong>{record.date} · {MODULES[record.module as keyof typeof MODULES]?.short || record.module}</strong>
          <span>{record.subType} · {record.correct}/{record.total} · {record.duration} 分钟</span>
        </div>
      ))}
    </div>
  );
}

function today(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function daysAgo(offset: number) {
  const date = new Date();
  date.setDate(date.getDate() - offset);
  return today(date);
}

function normalizeRecord(input: Record<string, unknown>): TrainingRecord | null {
  const total = Number(input.total);
  const correct = Number(input.correct);
  const duration = Number(input.duration);
  const date = String(input.date || "");
  if (!date || !Number.isFinite(total) || !Number.isFinite(correct) || !Number.isFinite(duration)) return null;
  if (total <= 0 || correct < 0 || correct > total || duration < 0) return null;
  const now = new Date().toISOString();
  return {
    id: String(input.id || crypto.randomUUID()),
    date,
    module: normalizeModule(String(input.module || MODULE_NAMES[0])),
    subType: String(input.subType || "综合卷/混刷"),
    total: Math.round(total),
    correct: Math.round(correct),
    duration: Math.round(duration * 10) / 10,
    errorReason: String(input.errorReason || "无"),
    note: String(input.note || ""),
    createdAt: String(input.createdAt || now),
    updatedAt: String(input.updatedAt || now),
    deletedAt: input.deletedAt ? String(input.deletedAt) : null
  };
}

function normalizeRecords(input: TrainingRecord[]) {
  return input.map((record) => normalizeRecord(record as unknown as Record<string, unknown>)).filter(Boolean) as TrainingRecord[];
}

function normalizeModule(value: string) {
  if (MODULE_NAMES.includes(value)) return value;
  if (value.includes("言语")) return "言语理解与表达";
  if (value.includes("判断")) return "判断推理";
  if (value.includes("资料")) return "资料分析";
  if (value.includes("数量")) return "数量关系";
  if (value.includes("常识") || value.includes("政治")) return "常识判断";
  return MODULE_NAMES[0];
}

function lastSubType(moduleName: string) {
  const subs = MODULES[moduleName as keyof typeof MODULES]?.subs || MODULES["言语理解与表达"].subs;
  return subs[subs.length - 1] || "综合卷/混刷";
}

function mergeRecords(localRows: TrainingRecord[], remoteRows: TrainingRecord[]) {
  const map = new Map<string, TrainingRecord>();
  [...localRows, ...remoteRows].forEach((record) => {
    const current = map.get(record.id);
    if (!current || new Date(record.updatedAt).getTime() >= new Date(current.updatedAt).getTime()) {
      map.set(record.id, record);
    }
  });
  return Array.from(map.values());
}

function toRemoteRecord(record: TrainingRecord, userId: string): RemoteRecord {
  return {
    id: record.id,
    user_id: userId,
    date: record.date,
    module: record.module,
    sub_type: record.subType,
    total: record.total,
    correct: record.correct,
    duration: record.duration,
    error_reason: record.errorReason,
    note: record.note,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    deleted_at: record.deletedAt || null
  };
}

function fromRemoteRecord(row: RemoteRecord): TrainingRecord {
  return {
    id: row.id,
    date: row.date,
    module: row.module,
    subType: row.sub_type,
    total: row.total,
    correct: row.correct,
    duration: Number(row.duration),
    errorReason: row.error_reason,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  };
}

function makeStats(records: TrainingRecord[], settings: AppSettings) {
  const todayRows = records.filter((record) => record.date === today());
  const weekRows = records.filter((record) => record.date >= daysAgo(6));
  const todayTotal = sum(todayRows, "total");
  const allTotal = sum(records, "total");
  const allCorrect = sum(records, "correct");
  const allDuration = sum(records, "duration");
  return {
    todayTotal,
    todayRate: todayTotal ? Math.round((sum(todayRows, "correct") / todayTotal) * 100) : 0,
    weekTotal: sum(weekRows, "total"),
    allTotal,
    allRate: allTotal ? Math.round((allCorrect / allTotal) * 100) : 0,
    avgPace: allTotal ? Math.round((allDuration * 60) / allTotal) : 0,
    streak: streak(records),
    goalGap: Math.max(0, settings.dailyGoal - todayTotal)
  };
}

function makeTrend(records: TrainingRecord[], days: number) {
  return Array.from({ length: days }, (_, index) => {
    const date = daysAgo(days - index - 1);
    const rows = records.filter((record) => record.date === date);
    const total = sum(rows, "total");
    return {
      date: date.slice(5),
      total,
      rate: total ? Math.round((sum(rows, "correct") / total) * 100) : 0
    };
  });
}

function makeModuleStats(records: TrainingRecord[]) {
  return MODULE_NAMES.map((name) => {
    const rows = records.filter((record) => record.module === name);
    const total = sum(rows, "total");
    return {
      name,
      short: MODULES[name as keyof typeof MODULES].short,
      total,
      rate: total ? Math.round((sum(rows, "correct") / total) * 100) : 0
    };
  });
}

function makeSubtypeStats(records: TrainingRecord[]) {
  const map = new Map<string, TrainingRecord[]>();
  records.forEach((record) => map.set(record.subType, [...(map.get(record.subType) || []), record]));
  return Array.from(map.entries()).map(([name, rows]) => {
    const total = sum(rows, "total");
    return { name, total, rate: total ? Math.round((sum(rows, "correct") / total) * 100) : 0 };
  });
}

function makeReasonStats(records: TrainingRecord[]) {
  const map = new Map<string, number>();
  records.filter((record) => record.errorReason !== "无").forEach((record) => map.set(record.errorReason, (map.get(record.errorReason) || 0) + 1));
  return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
}

function makeInsights(records: TrainingRecord[], modules: ReturnType<typeof makeModuleStats>, reasons: ReturnType<typeof makeReasonStats>) {
  if (!records.length) return [{ title: "先录入第一组训练", text: "完成一次保存后，系统会自动生成趋势、弱项和错因建议。" }];
  const weakest = modules.filter((item) => item.total > 0).sort((a, b) => a.rate - b.rate)[0];
  const topReason = reasons.sort((a, b) => b.value - a.value)[0];
  return [
    weakest ? { title: `优先补强：${weakest.short}`, text: `当前正确率 ${weakest.rate}%，建议连续 3 天做小题组复盘。` } : { title: "模块数据不足", text: "每个模块至少录入一次后，雷达图会更准确。" },
    topReason ? { title: `主要错因：${topReason.name}`, text: `近阶段出现 ${topReason.value} 次，建议在笔记中记录触发条件。` } : { title: "错因结构良好", text: "当前没有明显错因聚集，继续保持复盘颗粒度。" },
    { title: "同步已自动化", text: "登录后新增、编辑、删除都会后台保存到云端。" }
  ];
}

function makeHeadline(stats: ReturnType<typeof makeStats>) {
  if (!stats.allTotal) return "从第一条训练记录开始，建立你的行测数据资产";
  if (stats.goalGap === 0) return "今日目标已达成，适合做错因复盘";
  return `今天还差 ${stats.goalGap} 题，完成后趋势会更稳`;
}

function rate(correct: number, total: number) {
  return total ? Math.round((correct / total) * 100) : 0;
}

function pace(record: TrainingRecord) {
  return record.total ? Math.round((record.duration * 60) / record.total) : 0;
}

function rateClass(record: TrainingRecord) {
  const value = rate(record.correct, record.total);
  if (value >= 85) return "rate good";
  if (value >= 70) return "rate warn";
  return "rate bad";
}

function sum(records: TrainingRecord[], key: "total" | "correct" | "duration") {
  return records.reduce((acc, record) => acc + Number(record[key] || 0), 0);
}

function streak(records: TrainingRecord[]) {
  const set = new Set(records.map((record) => record.date));
  let count = 0;
  const date = new Date();
  while (set.has(today(date))) {
    count += 1;
    date.setDate(date.getDate() - 1);
  }
  return count;
}

function viewTitle(view: View) {
  return { overview: "训练驾驶舱", entry: "快速录入", diagnosis: "专项诊断", ledger: "训练台账", account: "账户与同步" }[view];
}

function syncLabel(status: SyncStatus) {
  return { local: "本机保存", syncing: "自动同步中", synced: "已同步", offline: "离线待同步", error: "同步异常" }[status];
}

function formatTimer(ms: number) {
  const seconds = Math.floor(ms / 1000);
  const h = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function loadLegacyRecords() {
  const parsed = safeParse(localStorage.getItem("xingce_v20_records"));
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.records)) return parsed.records;
  return [];
}

function safeParse(text: string | null) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
