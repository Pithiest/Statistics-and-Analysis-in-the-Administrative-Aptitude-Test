import { Suspense, lazy, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  CheckCircle2,
  Clock3,
  Cloud,
  CloudOff,
  Download,
  Edit3,
  ListChecks,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Target,
  TimerReset,
  Trash2,
  Upload,
  Wand2
} from "./icons";
import {
  DEFAULT_SETTINGS,
  ERROR_REASONS,
  MAX_RECORD_DURATION,
  MAX_RECORD_TOTAL,
  MODULES,
  accent,
  avgPace,
  moduleDetail,
  moduleSubTypes,
  normalizeCode,
  paceState,
  paceText,
  percent,
  subTypeOptions,
  suggestedMinutes
} from "./model";
import type { EntryForm, ModuleName, QuickTemplate, Settings, SyncState, TrainingRecord } from "./model";

const ModuleTrendChart = lazy(() => import("./Charts").then((module) => ({ default: module.ModuleTrendChart })));
const SubTypeBarChart = lazy(() => import("./Charts").then((module) => ({ default: module.SubTypeBarChart })));

export function RecordView(props: {
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
            <Field label="题量"><input type="number" inputMode="numeric" min="1" max={MAX_RECORD_TOTAL} value={form.total} onChange={(event) => setTotal(event.target.value)} placeholder="完成题数" /></Field>
            <Field label="正确数"><input type="number" inputMode="numeric" min="0" max={form.total || MAX_RECORD_TOTAL} value={form.correct} onChange={(event) => setForm({ ...form, correct: event.target.value })} placeholder="做对几题" /></Field>
            <Field label="用时">
              <div className="input-action">
                <input type="number" inputMode="decimal" min="0.1" max={MAX_RECORD_DURATION} step="0.1" value={form.duration} onChange={(event) => setForm({ ...form, duration: event.target.value })} placeholder="分钟" />
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

export function Diagnosis({ records, settings, module, subType, range, setModule, setSubType, setRange, onEdit }: {
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
  const activeTabRef = useRef<HTMLButtonElement>(null);
  const detail = moduleDetail(records, module, settings, subType, range);
  const moduleAll = moduleDetail(records, module, settings, "全部题型", "全部");
  const allSubTypes = moduleSubTypes(records, module);
  const weakest = moduleAll.weakest;
  const emptyText = moduleAll.total ? "当前时间范围暂无记录，模块全量摘要仍会保留在上方。" : "当前模块暂无记录。";

  useEffect(() => {
    const revealActiveTab = () => activeTabRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    const frame = window.requestAnimationFrame(revealActiveTab);
    window.addEventListener("resize", revealActiveTab);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", revealActiveTab);
    };
  }, [module]);

  return (
    <div className="stack diagnosis-page">
      <section className="diagnosis-switcher">
        <div className="module-tabs">
          {modules.map((item) => {
            const quick = moduleDetail(records, item.name, settings, "全部题型", "全部");
            return (
              <button
                key={item.id}
                ref={module === item.name ? activeTabRef : undefined}
                className={module === item.name ? "active" : ""}
                onClick={() => setModule(item.name)}
              >
                <strong>{item.short}</strong>
                <span>{quick.total ? `${quick.rate}% · ${quick.total}题` : "暂无样本"}</span>
              </button>
            );
          })}
        </div>
        <div className="diagnosis-filters">
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
        </div>
      </section>

      <section className="diagnosis-command">
        <div className="diagnosis-action">
          <div>
            <span>当前优先动作</span>
            <strong>{weakest ? `处理 ${weakest.name}` : "先补一组真实样本"}</strong>
            <p>{detail.actions[2] || detail.actions[0]}</p>
          </div>
          {weakest && <button className="soft-btn" onClick={() => setSubType(weakest.name)}><Target /> 聚焦小项</button>}
        </div>
        <div className="diagnosis-signals">
          <DiagnosticSignal label="模块总样本" value={moduleAll.total} hint={moduleAll.total ? `${moduleAll.rate}% 正确率` : "暂无记录"} />
          <DiagnosticSignal label="当前筛选" value={detail.total} hint={`${range === "全部" ? "全部时间" : `近 ${range} 天`} · ${subType}`} />
          <DiagnosticSignal label="平均配速" value={detail.pace || "--"} hint="秒/题" />
          <DiagnosticSignal label="待复盘" value={detail.pending} hint={detail.pending ? "需要处理" : "当前清爽"} />
        </div>
      </section>

      <section className="diagnosis-grid">
        <section className="surface-section">
          <div className="panel-head">
            <div><h3>{module} 趋势</h3><span>{range === "全部" ? "全部时间" : `近 ${range} 天`} · 正确率与配速</span></div>
            <strong className="matrix-score">{detail.rate}<small>%</small></strong>
          </div>
          {detail.total ? (
            <ChartBox>
              <DeferredChart>
                <ModuleTrendChart data={detail.trend} targetRate={settings.targetRate} />
              </DeferredChart>
            </ChartBox>
          ) : <Empty text={emptyText} />}
        </section>
        <section className="surface-section">
          <div className="panel-head"><div><h3>错因拆解</h3><span>按错题数排序</span></div></div>
          {detail.reasons.length ? (
            <Bars rows={detail.reasons.map((item) => ({ name: item.name, value: item.value }))} empty="暂无错因数据" />
          ) : <Empty text="暂无错因数据。" />}
        </section>
      </section>

      <section className="surface-section subtype-surface">
        <div className="panel-head">
          <div><h3>题型健康明细</h3><span>保留原始题型；无样本的小项也会显示</span></div>
          <span className="table-caption">{detail.subTypes.filter((item) => item.total > 0).length}/{detail.subTypes.length} 已训练</span>
        </div>
        <SubTypeHealthTable rows={detail.subTypes} onSelect={setSubType} />
      </section>

      <section className="grid-two">
        <Panel title="题型正确率" note="只绘制有样本的小项">
          {detail.subTypes.some((item) => item.total > 0) ? (
            <ChartBox>
              <DeferredChart>
                <SubTypeBarChart data={detail.subTypes.filter((item) => item.total > 0)} />
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

function DiagnosticSignal({ label, value, hint }: { label: string; value: ReactNode; hint: string }) {
  return <div><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>;
}

function SubTypeHealthTable({ rows, onSelect }: {
  rows: ReturnType<typeof moduleDetail>["subTypes"];
  onSelect: (value: string) => void;
}) {
  return (
    <div className="subtype-table">
      <div className="subtype-head"><span>题型</span><span>状态</span><span>健康度</span><span>题量</span><span>正确率</span><span>配速</span><span>最近训练</span></div>
      {rows.map((item) => (
        <button key={item.name} className="subtype-row" onClick={() => onSelect(item.name)}>
          <strong>{item.name}</strong>
          <span className={`risk-pill risk-${riskClass(item.risk)}`}>{item.risk}</span>
          <span className="health-cell"><i><b style={{ width: `${item.health}%` }} /></i>{item.health || "--"}</span>
          <span>{item.total}</span>
          <span>{item.total ? `${item.rate}%` : "--"}</span>
          <span>{item.pace ? `${item.pace}s` : "--"}</span>
          <small>{item.lastDate || "未训练"}</small>
        </button>
      ))}
    </div>
  );
}

function riskClass(risk: string) {
  if (risk === "稳定") return "good";
  if (risk === "待采样" || risk === "样本少") return "neutral";
  if (risk === "正确率低") return "bad";
  return "warning";
}

export function Review({ records, onDone, onEdit, onDelete }: { records: TrainingRecord[]; onDone: (record: TrainingRecord) => void; onEdit: (record: TrainingRecord) => void; onDelete: (record: TrainingRecord) => void }) {
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

export function Ledger({ records, query, module, reason, sort, onQuery, onModule, onReason, onSort, onEdit, onDelete }: {
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
      <section className="surface-section ledger-surface">
        <div className="panel-head">
          <div><h3>训练明细</h3><span>当前筛选共 {records.length} 条记录</span></div>
        </div>
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
      </section>
    </div>
  );
}

export function SettingsView({ settings, setSettings, spaceCode, setSpaceCode, syncState, lastSync, onGenerate, onSync, onClear, onExportJson, onExportCsv, onImport }: {
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
  const [perf, setPerf] = useState<PerformanceSnapshot>(() => collectPerformanceSnapshot());
  useEffect(() => setDraft(spaceCode), [spaceCode]);
  useEffect(() => {
    const update = () => setPerf(collectPerformanceSnapshot());
    const id = window.setTimeout(update, 800);
    window.addEventListener("load", update, { once: true });
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("load", update);
    };
  }, []);
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
            <div><strong>缓存</strong><span>页面走新版优先，核心资源会在后台预热，旧资源异常会自动恢复。</span></div>
          </div>
        </Panel>
      </section>

      <section className="grid-two">
        <Panel title="访问自检" note={perf.verdict}>
          <div className="perf-grid">
            <div><span>首屏绘制</span><strong>{perf.fcp ? `${perf.fcp}ms` : "--"}</strong></div>
            <div><span>HTML 响应</span><strong>{perf.html ? `${perf.html}ms` : "--"}</strong></div>
            <div><span>最慢资源</span><strong>{perf.slowestMs ? `${perf.slowestMs}ms` : "--"}</strong><small>{perf.slowestName || "等待采样"}</small></div>
            <div><span>本机缓存</span><strong>{perf.swControlled ? "已接管" : "准备中"}</strong></div>
          </div>
        </Panel>
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

type PerformanceSnapshot = {
  fcp: number;
  html: number;
  slowestMs: number;
  slowestName: string;
  swControlled: boolean;
  verdict: string;
};

function collectPerformanceSnapshot(): PerformanceSnapshot {
  const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const paint = performance.getEntriesByName("first-contentful-paint")[0];
  const resources = performance
    .getEntriesByType("resource")
    .filter((entry) => entry.name.startsWith(location.origin) && /\/assets\/.+\.(js|css)$/.test(entry.name))
    .sort((a, b) => b.duration - a.duration);
  const slowest = resources[0];
  const html = navigation ? Math.max(0, Math.round(navigation.responseEnd - navigation.startTime)) : 0;
  const fcp = paint ? Math.round(paint.startTime) : 0;
  const slowestMs = slowest ? Math.round(slowest.duration) : 0;
  const slowestName = slowest ? slowest.name.split("/").pop() || "" : "";
  const networkSlow = html > 3000 || slowestMs > 5000;
  return {
    fcp,
    html,
    slowestMs,
    slowestName,
    swControlled: Boolean(navigator.serviceWorker?.controller),
    verdict: networkSlow ? "当前访问链路偏慢，主要看域名/CDN资源耗时" : "访问链路正常，后续刷新会走本机缓存"
  };
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

function formatTimer(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
