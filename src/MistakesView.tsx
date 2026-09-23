import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import DOMPurify from "dompurify";
import { ArrowRight, CheckCircle2, Clock3, Download, ListChecks, Save, Search, Upload } from "./icons";
import { rateMistake, updateMistakeNote } from "./mistakes";
import type { MistakeNotebook, MistakeQuestion } from "./mistakes";
import "./mistakes.css";

type ReviewRating = "again" | "hard" | "good";
type ReviewFilter = "all" | "due" | "new" | "reviewed";

const PAGE_SIZE = 24;
const HTML_TAGS = ["p", "div", "span", "br", "strong", "b", "em", "i", "u", "s", "sub", "sup", "ol", "ul", "li", "table", "thead", "tbody", "tr", "th", "td", "blockquote", "img", "hr", "h2", "h3", "h4"];

/** Source HTML is untrusted, even when the export came from our own connector. */
export function sanitizeQuestionHtml(html: string): string {
  const fragment = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: HTML_TAGS,
    ALLOWED_ATTR: ["src", "alt", "title", "colspan", "rowspan"],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  });
  for (const img of fragment.querySelectorAll("img")) {
    let safe = false;
    try {
      const url = new URL(img.getAttribute("src") || "");
      safe = url.protocol === "https:" && !url.username && !url.password && !url.port && (url.hostname === "fbstatic.cn" || url.hostname.endsWith(".fbstatic.cn") || url.hostname === "fb.fenbike.cn");
    } catch { /* Missing, relative, and malformed image URLs stay out of the document. */ }
    if (!safe) {
      img.replaceWith(document.createTextNode("［题图地址不受支持］"));
      continue;
    }
    img.setAttribute("loading", "lazy");
    img.setAttribute("decoding", "async");
    img.setAttribute("referrerpolicy", "no-referrer");
    if (!img.getAttribute("alt")) img.setAttribute("alt", "题目配图");
  }
  const container = document.createElement("div");
  container.append(fragment);
  return container.innerHTML;
}

function plainText(html: string): string {
  const fragment = DOMPurify.sanitize(html, { ALLOWED_TAGS: [], ALLOWED_ATTR: [], RETURN_DOM_FRAGMENT: true });
  return (fragment.textContent || "").replace(/\s+/g, " ").trim();
}

export function QuestionHtml({ html, className = "" }: { html: string; className?: string }) {
  const safeHtml = useMemo(() => sanitizeQuestionHtml(html), [html]);
  return <div className={`mistake-richtext ${className}`} dangerouslySetInnerHTML={{ __html: safeHtml }} />;
}

function dueNow(question: MistakeQuestion, now = Date.now()) {
  return !question.progress.dueAt || new Date(question.progress.dueAt).getTime() <= now;
}

function dateLabel(value: string | null) {
  if (!value) return "尚未复习";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
}

function dueLabel(question: MistakeQuestion, now: number) {
  if (!question.progress.lastReviewedAt) return "待首次复习";
  if (dueNow(question, now)) return "到期复习";
  return `${dateLabel(question.progress.dueAt)} 复习`;
}

function nextReviewLabel(question: MistakeQuestion, rating: ReviewRating) {
  const now = new Date();
  const next = rateMistake(question, rating, now);
  if (!next.progress.dueAt) return "稍后复习";
  const minutes = Math.round((new Date(next.progress.dueAt).getTime() - now.getTime()) / 60000);
  return minutes < 1440 ? `${minutes} 分钟后` : `${Math.round(minutes / 1440)} 天后`;
}

export function MistakesView(props: {
  notebook: MistakeNotebook;
  onChange: (next: MistakeNotebook) => void;
  onImport: (file: File) => void | Promise<void>;
  onExport: () => void;
  connectionSlot?: ReactNode;
}) {
  const { notebook, onChange } = props;
  const [module, setModule] = useState("");
  const [knowledge, setKnowledge] = useState("");
  const [status, setStatus] = useState<ReviewFilter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sessionIds, setSessionIds] = useState<string[]>([]);
  const [sessionPosition, setSessionPosition] = useState(0);
  const [notice, setNotice] = useState("");
  const [noticeError, setNoticeError] = useState(false);
  const [importing, setImporting] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const importInput = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(id);
  }, []);
  const searchable = useMemo(() => notebook.questions.map((question) => ({
    question,
    preview: plainText(question.source.stemHtml) || "含图片或材料的题目，点击查看完整内容。",
  })), [notebook.questions]);
  const modules = useMemo(() => [...new Set(notebook.questions.map((q) => q.source.module))].filter(Boolean).sort(), [notebook.questions]);
  const knowledgePoints = useMemo(() => [...new Set(notebook.questions.filter((q) => !module || q.source.module === module).flatMap((q) => q.source.knowledgePoints))].sort(), [module, notebook.questions]);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return searchable.filter(({ question: q, preview }) => {
      if (module && q.source.module !== module) return false;
      if (knowledge && !q.source.knowledgePoints.includes(knowledge)) return false;
      if (status === "due" && !dueNow(q, now)) return false;
      if (status === "new" && q.progress.lastReviewedAt) return false;
      if (status === "reviewed" && !q.progress.lastReviewedAt) return false;
      return !query || [preview, q.source.module, ...q.source.knowledgePoints, q.progress.note, q.questionId].join(" ").toLocaleLowerCase().includes(query);
    });
  }, [searchable, module, knowledge, status, search, now]);
  const dueCount = notebook.questions.filter((q) => dueNow(q, now)).length;
  const reviewedCount = notebook.questions.filter((q) => q.progress.lastReviewedAt).length;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const selected = notebook.questions.find((q) => q.id === selectedId);
  const clearFilters = () => { setModule(""); setKnowledge(""); setStatus("all"); setSearch(""); setPage(0); };
  const showQuestion = (id: string, ids: string[] = [], position = 0) => {
    setSelectedId(id); setSessionIds(ids); setSessionPosition(position); setNotice("");
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  };
  const updateQuestion = (question: MistakeQuestion) => onChange({ ...notebook, questions: notebook.questions.map((item) => item.id === question.id ? question : item) });
  const returnToList = () => {
    setSelectedId(null); setSessionIds([]); setSessionPosition(0);
    window.requestAnimationFrame(() => headingRef.current?.focus());
  };
  const beginReview = () => {
    const queue = filtered.map(({ question }) => question).filter((q) => dueNow(q, now))
      .sort((a, b) => (a.progress.dueAt || "").localeCompare(b.progress.dueAt || ""));
    if (queue.length) showQuestion(queue[0].id, queue.map((q) => q.id));
  };
  const nextQuestion = () => {
    const nextPosition = sessionPosition + 1;
    const id = sessionIds[nextPosition];
    if (id) showQuestion(id, sessionIds, nextPosition);
    else { returnToList(); setNoticeError(false); setNotice("这一组已完成。根据刚才的掌握程度，已安排下一次复习。"); }
  };
  const hasFilter = Boolean(module || knowledge || status !== "all" || search);
  const filteredDueCount = filtered.filter(({ question }) => dueNow(question, now)).length;

  if (selected) return <QuestionReader
    key={selected.id}
    question={selected}
    position={sessionIds.length ? sessionPosition + 1 : undefined}
    sessionLength={sessionIds.length}
    onUpdate={updateQuestion}
    onBack={returnToList}
    onNext={nextQuestion}
  />;

  return <div className="stack mistake-page">
    <section className="panel mistake-overview">
      <div className="mistake-overview-copy">
        <span className="mistake-eyebrow">粉笔错题本</span>
        <h2 ref={headingRef} tabIndex={-1}>把错题练会</h2>
        <p>先重新作答，再对照解析。记下卡点，下次按掌握程度继续练。</p>
      </div>
      <div className="mistake-overview-stats" aria-label="错题统计">
        <div><strong>{notebook.questions.length}</strong><span>已收录</span></div>
        <div className="is-due"><strong>{dueCount}</strong><span>待复习</span></div>
        <div><strong>{reviewedCount}</strong><span>已复习过</span></div>
      </div>
    </section>
    {props.connectionSlot}
    {notice && <div className="mistake-notice" data-error={noticeError || undefined} role={noticeError ? "alert" : "status"}>{!noticeError && <CheckCircle2 />}<span>{notice}</span></div>}
    <div className="mistake-library-actions">
      <div><span className="mistake-muted">{notebook.lastImportedAt ? `最近导入：${dateLabel(notebook.lastImportedAt)}` : "导入后保留你的笔记和复习进度"}</span></div>
      <div className="button-row">
        <input ref={importInput} type="file" accept=".json,application/json" hidden onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setImporting(true);
          try { await props.onImport(file); }
          catch (error) { setNoticeError(true); setNotice(error instanceof Error ? error.message : "错题本备份导入失败，原错题本已保留。"); }
          finally { setImporting(false); }
        }} />
        <button type="button" className="soft-btn" disabled={importing} onClick={() => importInput.current?.click()}><Upload />{importing ? "正在导入…" : "导入错题本备份"}</button>
        <button type="button" className="soft-btn" disabled={!notebook.questions.length} onClick={props.onExport}><Download />导出错题本备份</button>
      </div>
    </div>
    {!notebook.questions.length ? <section className="panel mistake-empty">
      <span className="mistake-empty-icon"><ListChecks /></span>
      <h3>错题，留在一个地方复盘</h3>
      <p>连接粉笔同步服务，或导入插件导出的错题 JSON。题干、选项、材料和解析会一起收录。</p>
      <ol className="mistake-empty-steps"><li><b>1</b><span>同步自己的错题</span></li><li><b>2</b><span>先重做，再看解析</span></li><li><b>3</b><span>记笔记，按计划复习</span></li></ol>
      <button type="button" className="primary-btn" disabled={importing} onClick={() => importInput.current?.click()}><Upload />导入错题本备份</button>
      <small>已有错题再次导入时，会合并内容并保留复盘记录。</small>
    </section> : <section className="panel mistake-library">
      <div className="mistake-library-heading">
        <div><h3>我的错题</h3><p>{filtered.length} 题符合筛选{hasFilter ? `，共 ${notebook.questions.length} 题` : ""}</p></div>
        <button type="button" className="primary-btn" disabled={!filteredDueCount} onClick={beginReview}><ListChecks />复习待练题 <span className="mistake-button-count">{filteredDueCount}</span></button>
      </div>
      <div className="mistake-filters">
        <label className="mistake-search"><Search /><input aria-label="搜索错题题干、知识点或笔记" type="search" placeholder="搜索题干、知识点或笔记" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} /></label>
        <label><span>模块</span><select value={module} onChange={(e) => { setModule(e.target.value); setKnowledge(""); setPage(0); }}><option value="">全部模块</option>{modules.map((name) => <option key={name}>{name}</option>)}</select></label>
        <label><span>知识点</span><select value={knowledge} onChange={(e) => { setKnowledge(e.target.value); setPage(0); }}><option value="">全部知识点</option>{knowledgePoints.map((name) => <option key={name}>{name}</option>)}</select></label>
        <label><span>复习状态</span><select value={status} onChange={(e) => { setStatus(e.target.value as ReviewFilter); setPage(0); }}><option value="all">全部状态</option><option value="due">待复习</option><option value="new">未复习</option><option value="reviewed">已复习过</option></select></label>
      </div>
      {filtered.length ? <>
        <div className="mistake-question-list">
          {filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map(({ question, preview }, index) => <button type="button" key={question.id} className="mistake-question-row" onClick={() => showQuestion(question.id)}>
            <span className="mistake-question-number">{currentPage * PAGE_SIZE + index + 1}</span>
            <span className="mistake-question-summary">
              <span className="mistake-question-meta"><span>{question.source.module || "未分类"}</span>{question.source.knowledgePoints.slice(0, 2).map((point) => <span key={point}>{point}</span>)}</span>
              <span className="mistake-question-preview">{preview}</span>
              <span className="mistake-question-foot"><span className={dueNow(question, now) ? "mistake-due-label" : ""}><Clock3 />{dueLabel(question, now)}</span>{question.progress.note && <span>有笔记</span>}{!question.source.inSource && <span>已从粉笔错题中移出</span>}</span>
            </span>
            <ArrowRight className="mistake-row-arrow" />
          </button>)}
        </div>
        <div className="mistake-pagination">
          <span>第 {currentPage + 1} / {totalPages} 页</span>
          <div className="button-row"><button className="soft-btn" type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button><button className="soft-btn" type="button" disabled={currentPage + 1 >= totalPages} onClick={() => setPage(currentPage + 1)}>下一页</button></div>
        </div>
      </> : <div className="mistake-no-results"><Search /><h3>没有找到符合条件的错题</h3><p>换个关键词，或清除筛选看看。</p><button type="button" className="soft-btn" onClick={clearFilters}>清除筛选</button></div>}
    </section>}
  </div>;
}

function QuestionReader(props: {
  question: MistakeQuestion;
  position?: number;
  sessionLength: number;
  onUpdate: (question: MistakeQuestion) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const { question } = props;
  const { source, progress } = question;
  const [revealed, setRevealed] = useState(false);
  const [answers, setAnswers] = useState<string[]>([]);
  const [writtenAnswer, setWrittenAnswer] = useState("");
  const [note, setNote] = useState(progress.note);
  const [noteEdited, setNoteEdited] = useState(false);
  const [savedNote, setSavedNote] = useState(false);
  const [rating, setRating] = useState<ReviewRating | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const answerRef = useRef<HTMLElement>(null);
  const noteDirty = noteEdited && note !== progress.note;
  useEffect(() => { if (!noteEdited) setNote(progress.note); }, [progress.note, noteEdited]);
  const choice = source.answerKind === "choice" && source.options.length > 0;
  useEffect(() => { titleRef.current?.focus({ preventScroll: true }); }, []);
  const withNote = () => noteDirty ? updateMistakeNote(question, note) : question;
  const saveNote = () => { if (noteDirty) props.onUpdate(withNote()); setNoteEdited(false); setSavedNote(true); };
  const leave = (callback: () => void) => { if (noteDirty) props.onUpdate(withNote()); callback(); };
  const rate = (value: ReviewRating) => { props.onUpdate(rateMistake(withNote(), value)); setRating(value); setNoteEdited(false); setSavedNote(Boolean(note)); };
  const toggleAnswer = (label: string) => setAnswers((values) => values.includes(label) ? values.filter((value) => value !== label) : [...values, label]);
  const attemptedAnswer = choice ? source.options.filter((option) => answers.includes(option.label)).map((option) => option.label).join("、") : writtenAnswer.trim();
  const reveal = () => {
    setRevealed(true);
    window.requestAnimationFrame(() => answerRef.current?.focus({ preventScroll: true }));
  };
  return <div className="stack mistake-page mistake-reader">
    <div className="mistake-reader-navigation"><button type="button" className="soft-btn" onClick={() => leave(props.onBack)}><ArrowRight className="mistake-back-arrow" />返回错题本</button><span>{props.position ? `本组 ${props.position} / ${props.sessionLength}` : "逐题复盘"}</span></div>
    <section className="panel mistake-question-panel">
      <div className="mistake-reader-header">
        <div><span className="mistake-eyebrow">{source.module || "未分类"}</span><h2 ref={titleRef} tabIndex={-1}>{source.knowledgePoints[0] || "重新想一遍"}</h2></div>
        <span className="mistake-status-chip">{revealed ? "对照解析" : "先独立作答"}</span>
      </div>
      <div className="mistake-reader-tags">{source.knowledgePoints.slice(1).map((point) => <span key={point}>{point}</span>)}{!source.inSource && <span>保留的历史错题</span>}</div>
      {source.materials.length > 0 && <details className="mistake-materials" open><summary>阅读材料 <span>{source.materials.length} 则</span></summary><div>{source.materials.map((material, index) => <div className="mistake-material" key={`${material.id}-${index}`}>{source.materials.length > 1 && <h4>材料 {index + 1}</h4>}<QuestionHtml html={material.html} /></div>)}</div></details>}
      <QuestionHtml html={source.stemHtml} className="mistake-stem" />
      {source.options.length > 0 && <div className="mistake-options" role={choice ? "group" : undefined} aria-label="题目选项">
        {source.options.map((option, index) => choice ? <button type="button" key={`${option.label}-${index}`} className={`mistake-option${answers.includes(option.label) ? " is-selected" : ""}`} aria-pressed={answers.includes(option.label)} disabled={revealed} onClick={() => toggleAnswer(option.label)}><span className="mistake-option-label">{option.label}</span><QuestionHtml html={option.html} /></button> : <div key={`${option.label}-${index}`} className="mistake-option is-reference"><span className="mistake-option-label">{option.label}</span><QuestionHtml html={option.html} /></div>)}
      </div>}
      {!revealed && <div className="mistake-answer-action">
        {!choice && <label className="mistake-written-answer"><span>你的作答</span><textarea value={writtenAnswer} onChange={(event) => setWrittenAnswer(event.target.value)} placeholder={source.answerKind === "blanks" ? "依次记下填空答案，或先在纸上作答" : "简要记下答案与思路，也可以先在纸上作答"} /></label>}
        <p>{choice ? "点选你的答案；多选题可选择多项。再揭示原答案和解析。" : "先独立作答，再用原解析核对思路。"}</p>
        <button type="button" className="primary-btn" onClick={reveal}>查看答案与解析 <ArrowRight /></button>
      </div>}
      {source.sourceLabel && <p className="mistake-source-label">来源：{source.sourceLabel}</p>}
    </section>
    {revealed && <section ref={answerRef} tabIndex={-1} className="panel mistake-explanation" aria-label="答案与解析">
      <div className="mistake-section-heading"><h3>答案与解析</h3><span>对照推理过程，再判断掌握程度</span></div>
      <dl className="mistake-answer-comparison"><div><dt>正确答案</dt><dd>{source.correctAnswer || "原数据未提供，请参照解析"}</dd></div><div><dt>这次作答</dt><dd>{attemptedAnswer || "在纸上作答 / 未记录"}</dd></div><div><dt>粉笔原作答</dt><dd>{source.originalUserAnswer || "原数据未提供"}</dd></div></dl>
      {source.solutionHtml ? <QuestionHtml html={source.solutionHtml} /> : <p className="mistake-muted">本次导出的题目没有原解析，可回到粉笔核对。</p>}
    </section>}
    <section className="panel mistake-notes">
      <div className="mistake-section-heading"><h3>我的复盘笔记</h3><span>抓住一个下次能用上的方法</span></div>
      <label><span className="mistake-sr-only">复盘笔记</span><textarea maxLength={20000} value={note} onChange={(e) => { setNote(e.target.value); setNoteEdited(e.target.value !== progress.note); setSavedNote(false); }} placeholder="我错在什么地方？如何排除干扰项？下次看到什么条件就用这个方法？" /></label>
      <div className="mistake-note-footer"><span role="status">{noteDirty ? "笔记有修改，记得保存" : savedNote ? "笔记已记下" : progress.note ? "已有复盘笔记" : "保存在你的错题本中"}</span><button type="button" className="soft-btn" disabled={!noteDirty} onClick={saveNote}><Save />保存笔记</button></div>
    </section>
    {revealed && <section className="panel mistake-rating">
      <div className="mistake-section-heading"><h3>{rating ? "下次复习已安排" : "这次掌握得怎样？"}</h3><span>{rating ? `${dateLabel(progress.dueAt)} 再来巩固` : "按真实感觉选择，决定下一次见到这道题的时间。"}</span></div>
      {rating ? <div className="mistake-review-done" role="status"><CheckCircle2 /><p>已记下这次复盘{rating === "again" ? "，10 分钟后再练一次。" : `，${nextReviewLabelBeforeRating(question, rating)}。`}</p>{props.sessionLength ? <button type="button" className="primary-btn" onClick={() => leave(props.onNext)}>{props.position === props.sessionLength ? "完成本组复习" : "下一题"}<ArrowRight /></button> : <button type="button" className="soft-btn" onClick={() => leave(props.onBack)}>返回错题本</button>}</div> : <div className="mistake-rating-options">
        <button type="button" data-rating="again" onClick={() => rate("again")}><strong>还没掌握</strong><span>{nextReviewLabel(question, "again")}</span></button>
        <button type="button" data-rating="hard" onClick={() => rate("hard")}><strong>有点吃力</strong><span>{nextReviewLabel(question, "hard")}</span></button>
        <button type="button" data-rating="good" onClick={() => rate("good")}><strong>已经理解</strong><span>{nextReviewLabel(question, "good")}</span></button>
      </div>}
      <small>这里的复习安排和笔记保存在本网站，不会修改粉笔里的作答与错题状态。</small>
    </section>}
  </div>;
}

function nextReviewLabelBeforeRating(question: MistakeQuestion, rating: ReviewRating) {
  if (rating === "hard") return "明天继续巩固";
  return question.progress.dueAt ? `${dateLabel(question.progress.dueAt)} 继续巩固` : "稍后继续巩固";
}
