import {useEffect,useMemo,useState} from "react";
import type {FenbiAccount,FenbiSession} from "./mistakeApi";
import {getPracticeQuestion,mistakeErrorMessage} from "./mistakeApi";
import {practiceSummary} from "./fenbiPractice";
import type {FenbiPractice,PracticeAnswer} from "./fenbiPractice";
import type {MistakeQuestion} from "./mistakes";
import {QuestionHtml} from "./MistakesView";
import {ArrowRight,CheckCircle2,Clock3,Download,Search} from "./icons";
import "./practice.css";

type Filter="all"|"correct"|"wrong"|"slow";
const labels={all:"全部作答",correct:"做对的题",wrong:"错题与未答",slow:"答对但较慢"};
const outcomeLabel={correct:"答对",wrong:"答错",partial:"部分正确",unanswered:"未作答",unknown:"结果未提供"};
function matches(a:PracticeAnswer,filter:Filter){return filter==="all"||filter==="correct"&&a.outcome==="correct"||filter==="wrong"&&a.outcome!=="correct"||filter==="slow"&&a.outcome==="correct"&&a.seconds!==null&&a.seconds>90;}
function seconds(value:number|null){return value===null?"用时未提供":`${Math.round(value)} 秒`;}
function originalAnswer(a:PracticeAnswer){const choice=a.answer.choice;if(typeof choice==="string")return /^\d+(?:,\d+)*$/.test(choice)?choice.split(",").map(n=>Number(n)<26?String.fromCharCode(65+Number(n)):n).join("、"):choice;return Array.isArray(a.answer.blanks)?a.answer.blanks.join("；"):typeof a.answer.answer==="string"?a.answer.answer:"未提供";}
export function PracticeView({items,session,account,online,accountError,selectedKey,onSelect,onSettings,onReview}:{items:FenbiPractice[];session:FenbiSession|null;account:FenbiAccount|null;online:boolean;accountError:boolean;selectedKey:string|null;onSelect:(key:string|null)=>void;onSettings:()=>void;onReview:(key:string)=>Promise<void>}){
 const [filter,setFilter]=useState<Filter>("all"),[query,setQuery]=useState(""),[page,setPage]=useState(0),[questionId,setQuestionId]=useState<string|null>(null),[reviewBusy,setReviewBusy]=useState(false);
 const summary=useMemo(()=>practiceSummary(items),[items]);
 const selected=items.find(p=>p.key===selectedKey);
 useEffect(()=>{setQuestionId(null);},[selectedKey,session?.accountId]);
 const filtered=items.filter(p=>(!query||`${p.title} ${p.date} ${p.groups.map(g=>g.name).join(" ")}`.includes(query.trim()))&&(filter==="all"||p.answers.some(a=>matches(a,filter))));
 const exportData=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({schemaVersion:1,exportedAt:new Date().toISOString(),practices:items},null,2)],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download="粉笔练习记录.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 if(!session)return <section className="panel practice-empty"><h2>让每一次练习都有记录</h2><p>连接自己的粉笔账号，做对的题、错题、作答时间和用时会自动出现在这里，也会进入总览、诊断和台账。</p><button className="primary-btn" onClick={onSettings}>到设置连接粉笔 <ArrowRight /></button></section>;
 return <div className="stack practice-page">
  <section className="panel practice-heading"><div><span className="mistake-eyebrow">练习档案 · 粉笔自动同步</span><h2>{selected?selected.title:"把做过的题，变成下一次的优势"}</h2><p>{selected?`${selected.date} · ${selected.correct} / ${selected.total} 题答对 · ${selected.seconds===null?"实际用时未提供":`${Math.round(selected.seconds/60*10)/10} 分钟实际作答`}`:`已收录 ${summary.exercises} 次已完成练习。同题重做保留每次结果；总览的卷面正确率包含未答题，配速只使用有用时的实际作答。`}</p></div>{selected?<button className="soft-btn" onClick={()=>{onSelect(null);setQuestionId(null);}}>返回全部练习</button>:<button className="soft-btn" disabled={!items.length} onClick={exportData}><Download /> 导出练习记录</button>}</section>
  {!selected&&<div className="practice-metrics">
   <Metric label="实际作答" value={summary.answered.toLocaleString()} note={`${summary.total.toLocaleString()} 题次中，另有 ${summary.unanswered} 题未答`} />
   <Metric label="做对的题" value={summary.correct.toLocaleString()} note={summary.total?`${summary.answered?Math.round(summary.correct/summary.answered*100):0}% 已作答正确率`:"等待同步完成"} />
   <Metric label="答对时的配速" value={summary.correctPace===null?"—":`${summary.correctPace} 秒/题`} note={summary.wrongPace===null?"仅使用有真实用时的作答":`答错时平均 ${summary.wrongPace} 秒/题`} />
   <Metric label="答对但较慢" value={summary.slowCorrect.toLocaleString()} note="单题超过 90 秒，可回看解题方法" />
  </div>}
  {!online?<div className="notice-banner" role="status">当前离线，正在查看本机缓存的练习；联网后会检查更新。</div>:account&&!account.historyComplete?<div className="notice-banner" role="status">历史练习正在云端分批补齐，已有记录可以先看；关掉网页也会继续同步。</div>:!account&&!accountError?<div className="notice-banner" role="status">正在检查练习同步状态，已缓存的记录可以先看。</div>:null}
  {!!account?.historyExcluded&&<div className="notice-banner is-warning">有 {account.historyExcluded} 次练习报告未提供完整可用数据，暂未计入统计，下次同步会重新检查。</div>}
  <div className="practice-filters" role="group" aria-label="作答筛选">{(Object.keys(labels) as Filter[]).map(f=><button key={f} className={filter===f?"active":""} aria-pressed={filter===f} onClick={()=>{setFilter(f);setPage(0);}}>{labels[f]}</button>)}</div>
  {selected ? <>
   <div className="practice-detail-grid"><section className="panel"><div className="practice-section-heading"><h3>逐题回看</h3><span>保留本次作答，不影响统计</span></div><div className="practice-answer-list">{selected.answers.map((a,i)=>({a,i})).filter(({a})=>matches(a,filter)).map(({a,i})=><button key={a.id} className={`practice-answer ${questionId===a.id?"active":""}`} onClick={()=>setQuestionId(a.id)}><span>第 {i+1} 题</span><span className={`practice-outcome ${a.outcome}`}>{outcomeLabel[a.outcome]}</span><span>{seconds(a.seconds)}</span><ArrowRight /></button>)}</div>{!selected.answers.some(a=>matches(a,filter))&&<p className="empty">这次练习没有符合筛选的题。</p>}{selected.answers.length<selected.total&&<p>粉笔只返回了 {selected.answers.length} 道逐题记录；总题数按成绩报告保留。</p>}</section>
   <section className="panel practice-reader">{questionId?<PracticeQuestion key={`${session.accountId}:${selected.key}:${questionId}`} session={session} exercise={selected.key} questionId={questionId}/>:<div className="practice-empty"><Clock3 /><h3>选一道题，重新想一遍</h3><p>正确题也能回看题干和解析。先自己作答，再展开答案，看看是否有更快的方法。</p></div>}</section></div>
   <div className="practice-footer"><p>本次练习按真实模块与题型进入统计，回看解析不会新增刷题量。</p><button className="primary-btn" disabled={reviewBusy||Boolean(selected.reviewedAt)} onClick={async()=>{setReviewBusy(true);try{await onReview(selected.key);}finally{setReviewBusy(false);}}}><CheckCircle2 />{selected.reviewedAt?"本次已复盘":reviewBusy?"正在保存…":"标记本次复盘完成"}</button></div>
  </> : <>
   <div className="search"><Search/><input value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}} placeholder="搜索练习名称、日期或题型" aria-label="搜索粉笔练习" /></div>
   <section className="practice-list">{filtered.slice(page*20,page*20+20).map(p=><button className="panel practice-card" key={p.key} onClick={()=>onSelect(p.key)}><div className="practice-card-date">{p.date}<span>{p.reviewedAt?"已复盘":"可回看"}</span></div><strong>{p.title}</strong><div className="practice-card-tags">{[...new Set(p.groups.map(g=>g.module))].map(m=><span key={m}>{m}</span>)}</div><div className="practice-card-result"><span><b>{Math.round(p.correct/p.total*100)}<small>%</small></b> 正确率</span><span>{p.correct}/{p.total} 题答对<br/>{p.seconds===null?"用时未提供":`${Math.round(p.seconds/60*10)/10} 分钟实际用时`}</span><ArrowRight /></div></button>)}</section>
   {!filtered.length&&<section className="panel practice-empty"><h3>{items.length?"没有符合筛选的练习":account?.historyComplete?"还没有可统计的已完成练习":"正在接续你的练习记录"}</h3><p>{items.length?"调整筛选，查看其他练习。":account?.historyComplete?"完成粉笔行测练习后，这里会显示可读取的记录。":"云端将自动读取已完成的历史练习，无需手动录入。"}</p></section>}
   {filtered.length>20&&<div className="practice-pagination"><button className="soft-btn" disabled={!page} onClick={()=>setPage(p=>p-1)}>上一页</button><span>{page+1} / {Math.ceil(filtered.length/20)}</span><button className="soft-btn" disabled={(page+1)*20>=filtered.length} onClick={()=>setPage(p=>p+1)}>下一页</button></div>}
  </>}
 </div>;
}
function Metric({label,value,note}:{label:string;value:string;note:string}){return <div className="panel practice-metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;}
function PracticeQuestion({session,exercise,questionId}:{session:FenbiSession;exercise:string;questionId:string}){
 const [data,setData]=useState<{question:MistakeQuestion;answer:PracticeAnswer}|null>(null),[error,setError]=useState(""),[revealed,setRevealed]=useState(false),[choice,setChoice]=useState("");
 useEffect(()=>{const abort=new AbortController();void getPracticeQuestion(session.token,exercise,questionId,abort.signal).then(setData).catch(e=>{if(!abort.signal.aborted)setError(mistakeErrorMessage(e));});return()=>abort.abort();},[session.token,exercise,questionId]);
 if(error)return <div role="alert">{error}</div>;if(!data)return <div role="status" className="practice-empty">正在读取题目与解析…</div>;
 const q=data.question.source;
 return <div className="stack"><div className="practice-section-heading"><strong>当时{outcomeLabel[data.answer.outcome]} · {seconds(data.answer.seconds)}</strong><span>{q.module}</span></div>{q.materials.map((m,i)=><details className="mistake-materials" key={m.id} open><summary>阅读材料 {i+1}</summary><QuestionHtml html={m.html}/></details>)}<QuestionHtml html={q.stemHtml}/><div className="mistake-options">{q.options.map(o=><button className={`mistake-option ${choice===o.label?"is-selected":""}`} key={o.label} disabled={revealed} onClick={()=>setChoice(o.label)} aria-pressed={choice===o.label}><span className="mistake-option-label">{o.label}</span><QuestionHtml html={o.html}/></button>)}</div>{!revealed?<button className="primary-btn" onClick={()=>setRevealed(true)}>查看答案与解析</button>:<><dl className="mistake-answer-comparison"><div><dt>正确答案</dt><dd>{q.correctAnswer||"见解析"}</dd></div><div><dt>本次回看</dt><dd>{choice||"未选择"}</dd></div><div><dt>当时的作答</dt><dd>{originalAnswer(data.answer)}</dd></div></dl><QuestionHtml html={q.solutionHtml||"<p>原题暂未提供解析。</p>"}/></>}</div>;
}
