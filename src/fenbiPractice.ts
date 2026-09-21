import type { ModuleName, TrainingRecord } from "./model.ts";

export type PracticeAnswer = { id: string; outcome: "correct" | "wrong" | "partial" | "unanswered" | "unknown"; seconds: number | null; answer: Record<string, unknown> };
export type PracticeGroup = { module: ModuleName; name: string; total: number; correct: number; seconds: number | null; pacedTotal?: number; pacedSeconds?: number };
export type FenbiPractice = {
  key: string; title: string; submittedAt: string; date: string; total: number; correct: number;
  seconds: number | null; groups: PracticeGroup[]; answers: PracticeAnswer[]; sourceVersion: string;
  reviewedAt?: string | null;
};
const obj = (v: any): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const integer = (v: any) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const time = (v: any): number | null => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 864000 ? v : null;
const modules = new Set<ModuleName>(["全模块测试", "言语理解与表达", "判断推理", "资料分析", "数量关系", "常识判断"]);
function moduleName(value: string): ModuleName | null { return modules.has(value as ModuleName) ? value as ModuleName : value === "政治理论" ? "常识判断" : null; }
function validCount(v: any) { return obj(v) && integer(v.questionCount) && v.questionCount > 0 && integer(v.correctCount) && v.correctCount <= v.questionCount; }
function partition(nodes: any[], total: number, correct: number) {
  return nodes.length > 0 && nodes.every(validCount) && nodes.reduce((s,n)=>s+n.questionCount,0) === total && nodes.reduce((s,n)=>s+n.correctCount,0) === correct;
}
/** Only completed, first-party reports. Never uses the report's basic.time (the allotted exam time). */
export function normalizePractice(history: any, report: any, solution: any): FenbiPractice {
  if (history?.status !== 1 || typeof history.exerciseKey !== "string" || !obj(report) || !obj(solution) || !Array.isArray(report.subReports)) throw new Error("incomplete exercise report");
  if (report.ancientExerciseId?.id !== history.exerciseId || solution.ancientExerciseId?.id !== history.exerciseId) throw new Error("exercise identity mismatch");
  const basic = report.subReports.find((r:any)=>r.type===0);
  const course = report.subReports.flatMap((r:any)=>r.type===1 && Array.isArray(r.courseReports) ? r.courseReports : []).find((r:any)=>r.tikuPrefix==="xingce");
  const stat = course?.courseStat;
  if (!validCount(stat) || !obj(solution.userAnswers)) throw new Error("no valid xingce statistics");
  const timestamp = basic?.submitTime;
  if (typeof timestamp !== "number" || timestamp < 946684800000 || timestamp > Date.now()+86400000) throw new Error("missing submission time");
  const submittedAt = new Date(timestamp).toISOString();
  const date = new Date(timestamp + 8*3600000).toISOString().slice(0,10);
  const seen = new Set<string>();
  const answers: PracticeAnswer[] = Object.values(solution.userAnswers).filter((a:any)=>a?.prefix==="xingce").map((a:any)=>{
    const id = String(a.id);
    if (!/^\d{1,20}$/.test(id) || seen.has(id)) throw new Error("invalid answer identity");
    seen.add(id);
    const outcome = [1,9].includes(a.status) ? "correct" : [-1,7].includes(a.status) ? "wrong" : a.status===8 ? "partial" : [0,6,10,11].includes(a.status) ? "unanswered" : "unknown";
    return {id, outcome, seconds:time(a.time), answer:obj(a.answer) ? a.answer : {}};
  });
  const total=stat.questionCount,correct=stat.correctCount,seconds=time(stat.elapseTime);
  if (answers.length > total || answers.filter(a=>a.outcome==="correct").length > correct) throw new Error("answer totals mismatch");
  const roots=Array.isArray(course.details)?course.details:[];
  const rawAnswers=solution.userAnswers;
  const answerTree=report.subReports.find((r:any)=>r.type===2);
  const byId=new Map(answers.map(a=>[a.id,a]));
  const answerIds=(node:any):string[]=>{const raw=rawAnswers[node.key];return raw?[String(raw.id)]:(Array.isArray(node.children)?node.children.flatMap(answerIds):[]);};
  const exactAnswers=(name:string,count:number):PracticeAnswer[]|null=>{
    const nodes=(answerTree?.children||[]).filter((n:any)=>n.name===name);
    const ids=[...new Set<string>(nodes.flatMap(answerIds))];
    if(ids.length===count&&ids.every(id=>byId.has(id)))return ids.map(id=>byId.get(id)!);
    return roots.length===1&&answers.length===count?answers:null;
  };
  const timing=(rows:PracticeAnswer[])=>{const timed=rows.filter(a=>a.seconds!==null&&["correct","wrong","partial"].includes(a.outcome));return {pacedTotal:timed.length,pacedSeconds:timed.reduce((sum,a)=>sum+a.seconds!,0)};};
  const allTimed=answers.length===total&&answers.every(a=>a.seconds!==null&&["correct","wrong","partial"].includes(a.outcome));
  let groups: PracticeGroup[]=[];
  if (partition(roots,total,correct) && roots.every((n:any)=>moduleName(n.name))) {
    for (const node of roots) {
      const children=Array.isArray(node.children)?node.children:[];
      // Deeper knowledge-point tags overlap; never sum them into training totals.
      const selected=allTimed && partition(children,node.questionCount,node.correctCount) ? children : [node];
      const childTime=selected.every((n:any)=>time(n.time)!==null) && selected.reduce((s:number,n:any)=>s+n.time,0)===node.time;
      const nodeAnswers=exactAnswers(node.name,node.questionCount);
      groups.push(...selected.map((n:any)=>({module:moduleName(node.name)!,name:String(n.name||node.name).slice(0,200),total:n.questionCount,correct:n.correctCount,seconds:childTime?time(n.time):selected.length===1?time(node.time):null,...(selected.length===1&&nodeAnswers?timing(nodeAnswers):allTimed&&time(n.time)!==null?{pacedTotal:n.questionCount,pacedSeconds:n.time}:{pacedTotal:0,pacedSeconds:0})})));
    }
  } else groups=[{module:"全模块测试",name:"综合卷/混刷",total,correct,seconds,...timing(answers)}];
  return {key:history.exerciseKey,title:String(history.sheetName||solution.name||"粉笔练习").slice(0,300),submittedAt,date,total,correct,seconds,groups,answers,sourceVersion:String(history.updatedTime)};
}

export function practiceRecords(practices: FenbiPractice[]): TrainingRecord[] {
  return practices.flatMap(p=>p.groups.map((g,i)=>({
    id:`fenbi:${p.key}:${i}`, date:p.date,module:g.module,subType:g.name,total:g.total,correct:g.correct,duration:g.seconds===null?0:g.seconds/60,pacedTotal:g.pacedTotal,paceSecondsTotal:g.pacedSeconds,
    errorReason:"无",tags:["粉笔自动同步"],note:p.title,reviewStatus:p.reviewedAt||p.correct===p.total?"reviewed" as const:"pending" as const,
    reviewedAt:p.reviewedAt||null,createdAt:p.submittedAt,updatedAt:p.submittedAt,deletedAt:null,
    source:"fenbi" as const,sourceKey:p.key
  })));
}

export function practiceSummary(practices: FenbiPractice[]) {
  const answers=practices.flatMap(p=>p.answers),timed=answers.filter(a=>a.seconds!==null&&["correct","wrong","partial"].includes(a.outcome)),correctTimed=timed.filter(a=>a.outcome==="correct"),wrongTimed=timed.filter(a=>a.outcome==="wrong");
  const average=(rows:PracticeAnswer[])=>rows.length?Math.round(rows.reduce((s,a)=>s+a.seconds!,0)/rows.length):null;
  return {answered:answers.filter(a=>["correct","wrong","partial"].includes(a.outcome)).length,unanswered:answers.filter(a=>a.outcome==="unanswered").length,exercises:practices.length,total:practices.reduce((s,p)=>s+p.total,0),correct:practices.reduce((s,p)=>s+p.correct,0),uniqueQuestions:new Set(answers.map(a=>a.id)).size,timed:timed.length,pace:average(timed),correctPace:average(correctTimed),wrongPace:average(wrongTimed),slowCorrect:correctTimed.filter(a=>a.seconds!>90).length};
}
