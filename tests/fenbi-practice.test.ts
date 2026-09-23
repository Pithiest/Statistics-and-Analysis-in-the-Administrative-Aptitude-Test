import assert from "node:assert/strict";
import test from "node:test";
import {normalizePractice,practiceRecords,practiceSummary} from "../src/fenbiPractice.ts";
function fixture() {
 const history={status:1,exerciseKey:"synthetic-exercise",exerciseId:1,sheetName:"合成练习",updatedTime:1780000000000};
 const report={ancientExerciseId:{id:1},subReports:[{type:0,submitTime:1780000000000,time:7200},{type:1,courseReports:[{tikuPrefix:"xingce",courseStat:{questionCount:2,correctCount:1,elapseTime:100},details:[{name:"判断推理",questionCount:2,correctCount:1,time:100,children:[{name:"逻辑判断",questionCount:1,correctCount:1,time:40},{name:"类比推理",questionCount:1,correctCount:0,time:60}]}]}]}]};
 const solution={ancientExerciseId:{id:1},userAnswers:{a:{prefix:"xingce",id:1,status:1,time:40,answer:{choice:"0"}},b:{prefix:"xingce",id:2,status:-1,time:60,answer:{choice:"1"}}}};
 return {history,report,solution};
}
test("completed history includes correct and wrong attempts, uses actual seconds and partitions counts once",()=>{
 const f=fixture(),p=normalizePractice(f.history,f.report,f.solution),rows=practiceRecords([p]);
 assert.equal(p.seconds,100);assert.equal(rows.reduce((n,r)=>n+r.total,0),2);assert.equal(rows.reduce((n,r)=>n+r.duration*60,0),100);
 assert.equal(p.answers[0].outcome,"correct");assert.equal(p.answers[1].outcome,"wrong");
 assert.deepEqual([practiceSummary([p]).correctPace,practiceSummary([p]).wrongPace],[40,60]);
 assert.ok(rows.every(r=>r.source==="fenbi"));
 assert.deepEqual(rows.map(r=>r.reviewStatus),["reviewed","pending"]);
});
test("overlapping knowledge tags do not inflate training totals; missing time is excluded from pace",()=>{
 const f=fixture();const course=(f.report.subReports[1] as any).courseReports[0];course.details[0].children.push({...course.details[0].children[0]});course.courseStat.elapseTime=null;course.details[0].time=null;(f.solution.userAnswers.a as any).time=null;
 const p=normalizePractice(f.history,f.report,f.solution);assert.equal(p.groups.length,1);assert.equal(practiceRecords([p])[0].total,2);assert.equal(practiceRecords([p])[0].duration,0);assert.equal(p.seconds,null);assert.equal(practiceSummary([p]).correctPace,null);
});
test("rejects unfinished exercises, other exercise reports, invalid dates and unknown course stats",()=>{
 for(const change of [(f:any)=>f.history.status=0,(f:any)=>f.history.updatedTime=null,(f:any)=>f.report.ancientExerciseId.id=2,(f:any)=>f.report.subReports[0].submitTime=null,(f:any)=>f.report.subReports[1].courseReports[0].tikuPrefix="other"]){const f=fixture();change(f);assert.throws(()=>normalizePractice(f.history,f.report,f.solution));}
});

test("unanswered questions never inflate speed; module totals still retain the original paper denominator",()=>{
 const f=fixture();(f.solution.userAnswers.b as any).status=0;(f.solution.userAnswers.b as any).time=0;
 const p=normalizePractice(f.history,f.report,f.solution);const rows=practiceRecords([p]);
 assert.equal(p.total,2);assert.equal(rows.length,1);assert.equal(rows[0].pacedTotal,1);assert.equal(rows[0].paceSecondsTotal,40);
 assert.equal(practiceSummary([p]).answered,1);assert.equal(practiceSummary([p]).unanswered,1);
});
