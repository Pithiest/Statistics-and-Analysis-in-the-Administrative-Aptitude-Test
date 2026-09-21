import { startQr, pollQr, getIdentity, readTree, readQuestionBatch, readAnswers, registerDevice, ProviderError } from "./provider.ts";
import type { CookieJar } from "./provider.ts";
import { emptyMistakeNotebook, importFenbiExport, reuseUnchangedSource, mergeMistakeNotebooks, normalizeMistakeNotebook } from "../../../src/mistakes.ts";
import type { MistakeNotebook } from "../../../src/mistakes.ts";

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (req: Request) => Promise<Response>): void };
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };
const encoder = new TextEncoder();
const ALLOWED = new Set(["https://xc.pithiest.cn", "http://127.0.0.1:5178", "http://localhost:5178"]);
const TABLE = "xc_fb_accounts";
let runtimeKey: Promise<string> | undefined;
class HttpError extends Error { status:number; constructor(status: number, message: string) { super(message); this.status=status; } }
const now = () => new Date().toISOString();
const later = (ms: number) => new Date(Date.now() + ms).toISOString();
const random = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2,"0")).join("");
export async function digest(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(value))),x=>x.toString(16).padStart(2,"0")).join("");
}
function b64(value: Uint8Array) { let result=""; for(let i=0;i<value.length;i+=8192) result+=String.fromCharCode(...value.subarray(i,i+8192)); return btoa(result); }
function un64(value: string) { return Uint8Array.from(atob(value),x=>x.charCodeAt(0)); }
async function database(path: string, options: RequestInit = {}) {
  const root = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const response = await fetch(`${root}/rest/v1/${path}`,{...options,signal:AbortSignal.timeout(20000),headers:{apikey:key,Authorization:`Bearer ${key}`,"Content-Type":"application/json",...options.headers}});
  if(!response.ok) throw new HttpError(503,"云端保存暂时不可用，请稍后重试。");
  const text=await response.text(); return text?JSON.parse(text):null;
}
function key() { return runtimeKey ||= database("rpc/xc_fb_runtime_key",{method:"POST",body:"{}"}).then(value=>{if(typeof value!=="string"||value.length<32) throw new Error("runtime key unavailable");return value;}).catch(error=>{runtimeKey=undefined;throw error;}); }
async function cryptoKey() { return crypto.subtle.importKey("raw",await crypto.subtle.digest("SHA-256",encoder.encode(`xc-fenbi-session:v1:${await key()}`)),"AES-GCM",false,["encrypt","decrypt"]); }
async function seal(value: unknown) { const iv=crypto.getRandomValues(new Uint8Array(12)); const result=await crypto.subtle.encrypt({name:"AES-GCM",iv},await cryptoKey(),encoder.encode(JSON.stringify(value)));return `${b64(iv)}.${b64(new Uint8Array(result))}`; }
async function unseal(value: string) { const [iv,data]=value.split(".");const result=await crypto.subtle.decrypt({name:"AES-GCM",iv:un64(iv)},await cryptoKey(),un64(data));return JSON.parse(new TextDecoder().decode(result)); }
const patch = (table:string,filter:string,value:unknown) => database(`${table}?${filter}`,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify(value)});
const insert = (table:string,value:unknown) => database(table,{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify(value)});
function bearer(req:Request) { const token=req.headers.get("Authorization")?.replace(/^Bearer\s+/i,"")||"";if(!/^[a-f0-9]{64}$/.test(token))throw new HttpError(401,"请先连接自己的粉笔账号。");return token; }
async function account(req:Request,light=false) {
  const tokenHash=await digest(bearer(req));
  const sessions=await database(`xc_fb_sessions?token_hash=eq.${tokenHash}&expires_at=gt.${encodeURIComponent(now())}&select=account_id&limit=1`);
  if(!sessions?.length)throw new HttpError(401,"登录已过期，请重新扫码连接。");
  const rows=await database(`${light?"xc_fb_account_status":TABLE}?id=eq.${sessions[0].account_id}&select=*&limit=1`);
  if(!rows?.length)throw new HttpError(401,"账号连接不存在，请重新扫码。");
  return {row:rows[0],tokenHash};
}
function status(row:any) {return {sourceStamp:row.source_stamp??row.notebook?.lastImportedAt??null,progressRevision:row.progress_revision,accountId:row.id,displayName:row.display_name,lastSync:row.last_sync,lastAttempt:row.last_attempt,nextSync:row.next_sync,syncState:row.sync_state,error:row.last_error,questionCount:row.question_count??row.notebook?.questions?.length??0,loaded:row.sync_loaded??row.sync_cursor?.batches?.reduce((n:number,b:any)=>n+(b.solutions?.length||0),0)??0,total:row.sync_total??row.sync_cursor?.requestedQuestionIds?.length??0};}
export function withProgress(notebook:unknown,progress:unknown):MistakeNotebook {
  const book=normalizeMistakeNotebook(notebook);
  const map=new Map((Array.isArray(progress)?progress:[]).filter(x=>x&&typeof x.id==="string").map(x=>[x.id,x.progress]));
  return mergeMistakeNotebooks(book,normalizeMistakeNotebook({...book,questions:book.questions.map(q=>({...q,progress:map.get(q.id)||q.progress}))}));
}
export function progressOnly(book:MistakeNotebook) {return book.questions.filter(q=>q.progress.note||q.progress.history.length||q.progress.updatedAt>"1970-01-01T00:00:00.000Z").map(q=>({id:q.id,progress:q.progress}));}
function queueWork() { if(typeof EdgeRuntime!=="undefined") EdgeRuntime.waitUntil(workOne().catch(()=>{})); }
async function loginStart(req:Request) {
  const ip=req.headers.get("x-forwarded-for")?.split(",")[0]||req.headers.get("cf-connecting-ip")||"unknown";
  const ipHash=await digest(`${await key()}:ip:${ip}`);
  const previous=await database(`xc_fb_logins?ip_hash=eq.${ipHash}&created_at=gt.${encodeURIComponent(later(-600000))}&select=id&limit=30`);
  if(previous.length>=30)throw new HttpError(429,"二维码生成较频繁，请十分钟后重试。");
  const qr=await startQr();
  const challenge=random();
  const expiresAt=later(240000);
  await insert("xc_fb_logins",{token_hash:await digest(challenge),state_cipher:await seal(qr),ip_hash:ipHash,expires_at:expiresAt});
  return {challenge,codeContent:qr.codeContent,expiresAt};
}
async function loginPoll(body:any) {
  if(!/^[a-f0-9]{64}$/.test(body.challenge||""))throw new HttpError(400,"登录二维码无效。");
  const tokenHash=await digest(body.challenge);
  const rows=await database(`xc_fb_logins?token_hash=eq.${tokenHash}&expires_at=gt.${encodeURIComponent(now())}&select=*&limit=1`);
  if(!rows.length)throw new HttpError(410,"二维码已过期，请重新生成。");
  const challenge=rows[0];const state=await unseal(challenge.state_cipher);
  if(challenge.last_poll_at&&Date.now()-Date.parse(challenge.last_poll_at)<1800)return {status:1};
  const pollRevision=now();
  const locked=await patch("xc_fb_logins",`id=eq.${challenge.id}&last_poll_at=${challenge.last_poll_at?`eq.${encodeURIComponent(challenge.last_poll_at)}`:"is.null"}`,{last_poll_at:pollRevision});
  if(!locked.length)return {status:1};
  const result=await pollQr(state.lgtoken,state.cookies);
  state.cookies=result.cookies;
  if(result.status!==3) {
    await patch("xc_fb_logins",`id=eq.${challenge.id}&last_poll_at=eq.${encodeURIComponent(pollRevision)}`,{state_cipher:await seal(state)});
    return {status:result.status};
  }
  const identity=await getIdentity(state.cookies);
  const consumed=await database(`xc_fb_logins?id=eq.${challenge.id}&last_poll_at=eq.${encodeURIComponent(pollRevision)}`,{method:"DELETE",headers:{Prefer:"return=representation"}});
  if(!consumed?.length)throw new HttpError(410,"二维码已使用，请重新生成。");
  const providerKey=await digest(`${await key()}:fenbi:${identity.providerId}`);
  const accounts=await database(`${TABLE}?on_conflict=provider_key`,{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify({provider_key:providerKey,display_name:identity.displayName,session_cipher:await seal(state.cookies),sync_state:"queued",sync_cursor:null,last_error:null,next_sync:now(),locked_until:null})});
  const row=accounts[0];const token=random();
  await insert("xc_fb_sessions",{token_hash:await digest(token),account_id:row.id,expires_at:later(30*86400000)});
  queueWork();return {status:3,token,account:status(row)};
}

async function saveProgress(req:Request,body:any) {
  const auth=await account(req);
  if(!Array.isArray(body.progress)||body.progress.length>10000)throw new HttpError(400,"复盘数据格式不正确。");
  for(let attempt=0;attempt<3;attempt++) {
    const row=attempt?(await database(`${TABLE}?id=eq.${auth.row.id}&select=*&limit=1`))[0]:auth.row;
    const merged=mergeMistakeNotebooks(withProgress(row.notebook,row.progress),withProgress(row.notebook,body.progress));
    const saved=await patch(TABLE,`id=eq.${row.id}&progress_revision=eq.${row.progress_revision}`,{progress:progressOnly(merged),progress_revision:row.progress_revision+1});
    if(saved.length)return {progress:progressOnly(merged),revision:row.progress_revision+1};
  }
  throw new HttpError(409,"另一台设备正在保存，请稍后重试；本机进度仍保留。");
}

function collectIds(tree:any):string[] {const ids=new Set<string>();function visit(nodes:any){for(const node of Array.isArray(nodes)?nodes:[]){for(const id of node.questionIds||[])ids.add(String(id));visit(node.children);}}visit(tree);return [...ids];}
export async function workOne() {
  const deadline=Date.now()+60000;
  const claimed=await database("rpc/xc_fb_claim_job",{method:"POST",body:"{}"});
  if(!claimed?.length)return {processed:0};
  const row=claimed[0];let cursor=row.sync_cursor;
  const lease=`id=eq.${row.id}&locked_until=eq.${encodeURIComponent(row.locked_until)}`;
  let cookies:CookieJar|undefined;
  let providerSession:any;
  try {
    providerSession=await unseal(row.session_cipher);
    if(Array.isArray(providerSession))providerSession={cookies:providerSession};
    cookies=providerSession.cookies as CookieJar;
    if(!cursor) {
      const tree=await readTree(cookies,providerSession.deviceId);const ids=collectIds(tree);
      if(ids.length>10000)throw new HttpError(400,"错题数量超过当前单次同步范围，请联系网站维护者。");
      cursor={schemaVersion:1,exportedAt:now(),scope:{subject:"xingce",timeRange:0},tree,requestedQuestionIds:ids,batches:[],answers:[],warnings:[],complete:false};
    }
    let offset=cursor.batches.reduce((n:number,b:any)=>n+b.requestedIds.length,0);
    while(offset<cursor.requestedQuestionIds.length&&Date.now()<deadline) {
      const active=await database(`${TABLE}?${lease}&select=id&limit=1`);
      if(!active?.length)return {processed:1,cancelled:true};
      const ids=cursor.requestedQuestionIds.slice(offset,offset+10);
      const batch=await readQuestionBatch(cookies,ids,providerSession.deviceId);
      await new Promise(resolve=>setTimeout(resolve,400));
      if(!(await database(`${TABLE}?${lease}&select=id&limit=1`))?.length)return {processed:1,cancelled:true};
      const answers=await readAnswers(cookies,ids,providerSession.deviceId);
      cursor.batches.push(batch);cursor.answers.push(...answers);offset+=ids.length;
      await new Promise(resolve=>setTimeout(resolve,400));
    }
    if(offset<cursor.requestedQuestionIds.length) {
      const saved=await patch(TABLE,lease,{session_cipher:await seal({...providerSession,cookies}),sync_cursor:cursor,sync_state:"queued",locked_until:null,next_sync:now()});
      return saved.length?{processed:1,pending:true}:{processed:1,cancelled:true};
    }
    cursor.complete=true;
    const previous=normalizeMistakeNotebook(row.notebook);
    const next=importFenbiExport(cursor,previous);
    next.notebook=reuseUnchangedSource(previous,next.notebook);
    if(next.summary.warnings.length)throw new HttpError(503,"部分错题未完整返回，已保留上次成功数据。");
    const saved=await patch(TABLE,lease,{session_cipher:await seal({...providerSession,cookies}),notebook:next.notebook,sync_cursor:null,sync_state:"idle",last_sync:now(),next_sync:later(6*3600000),locked_until:null,last_error:null});
    return saved.length?{processed:1,complete:true,count:next.notebook.questions.length}:{processed:1,cancelled:true};
  } catch(error) {
    const needsLogin=error instanceof ProviderError&&["AUTH_REQUIRED","VERIFICATION_REQUIRED"].includes(error.code);
    const needsDevice=error instanceof ProviderError&&error.httpStatus===453;
    const saved=await patch(TABLE,lease,{...(cookies?{session_cipher:await seal({...providerSession,cookies})}:{}),sync_cursor:cursor||null,sync_state:needsLogin?"reauth":"error",last_error:needsDevice?"粉笔要求设备验证。扫码已成功，完成设备登记后才能继续读取错题。":needsLogin?"粉笔登录或验证需要更新，请在官方页面完成验证后重新连接。":"此次同步未完成，已保留上次成功数据。",locked_until:null,next_sync:later(3600000)});
    return saved.length?{processed:1,complete:false,needsLogin}:{processed:1,cancelled:true};
  }
}

export async function handler(req:Request):Promise<Response> {
  const origin=req.headers.get("Origin")||"";
  const headers:Record<string,string>={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Vary":"Origin","X-Content-Type-Options":"nosniff"};
  if(origin&&ALLOWED.has(origin))Object.assign(headers,{"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"authorization,content-type","Access-Control-Allow-Methods":"GET,POST,OPTIONS"});
  const response=(data:unknown,statusCode=200)=>new Response(JSON.stringify(data),{status:statusCode,headers});
  try {
    if(origin&&!ALLOWED.has(origin))return response({error:"访问来源不允许。"},403);
    if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
    const path=new URL(req.url).pathname.split("/fenbi-cloud")[1]||"/";
    if(path==="/health"&&req.method==="GET")return response({ready:true,login:"fenbi-app-qr",mode:"cloud",version:1});
    if(path==="/worker"&&req.method==="POST") {
      const supplied=req.headers.get("X-Fenbi-Worker")||"";
      if(!supplied||await digest(supplied)!==await digest(await key()))return response({error:"unauthorized"},401);
      return response(await workOne());
    }
    if(!["GET","POST"].includes(req.method))return response({error:"不支持此请求。"},405);
    let body:any={};
    if(req.method==="POST") {const text=await req.text();if(text.length>2_000_000)throw new HttpError(413,"提交内容过大。");try{body=JSON.parse(text||"{}");}catch{throw new HttpError(400,"请求格式不正确。");}}
    if(path==="/login/start"&&req.method==="POST")return response(await loginStart(req));
    if(path==="/login/poll"&&req.method==="POST")return response(await loginPoll(body));
    if(path==="/progress"&&req.method==="POST")return response(await saveProgress(req,body));
    const {row,tokenHash}=await account(req,path!=="/notebook"&&path!=="/verify-device");
    if(path==="/progress"&&req.method==="GET") { const data=(await database(`${TABLE}?id=eq.${row.id}&select=progress,progress_revision&limit=1`))[0];return response({progress:data.progress,revision:data.progress_revision}); }
    if(path==="/verify-device"&&req.method==="POST") {
      if(row.sync_state!=="reauth"||!row.session_cipher||!row.last_error?.includes("设备验证"))throw new HttpError(409,"当前连接不需要设备登记。");
      let session=await unseal(row.session_cipher);
      if(Array.isArray(session))session={cookies:session};
      if(session.deviceAttempted)throw new HttpError(409,"设备登记已经尝试过。请在粉笔官方页面完成所需验证，不能重复登记。");
      const fields=["canvas","webgl","screen","language","platform","cores","memory","touchPoints"];
      if(typeof body.startupId!=="string"||!/^\d{10,16}$/.test(body.startupId)||!body.extras||fields.some(f=>typeof body.extras[f]!=="string"||body.extras[f].length>1024))throw new HttpError(400,"浏览器设备信息不完整，请使用正常浏览器。");
      session.deviceAttempted=true;
      const reservation=await patch(TABLE,`id=eq.${row.id}&session_cipher=eq.${encodeURIComponent(row.session_cipher)}`,{session_cipher:await seal(session)});
      if(!reservation.length)throw new HttpError(409,"连接已更新，请刷新后查看状态。");
      const verificationLease=`id=eq.${row.id}&session_cipher=eq.${encodeURIComponent(reservation[0].session_cipher)}`;
      try {
        session.deviceId=await registerDevice(session.cookies,{startupId:body.startupId,extras:Object.fromEntries(fields.map(f=>[f,body.extras[f]])) as any});
        const saved=await patch(TABLE,verificationLease,{session_cipher:await seal(session),sync_state:"queued",last_error:null,next_sync:now(),locked_until:null});
        if(!saved.length)throw new HttpError(409,"连接已更改，请刷新后查看状态。");
        queueWork();return response(status(saved[0]));
      }catch(error) {
        await patch(TABLE,verificationLease,{session_cipher:await seal(session),sync_state:"reauth",last_error:"粉笔设备验证未完成，需要在粉笔官方服务中继续验证；已停止重复尝试。"});
        throw new HttpError(409,"粉笔设备验证未完成，需要官方验证；没有重复尝试。");
      }
    }
    if(path==="/account"&&req.method==="GET")return response(status(row));
    if(path==="/notebook"&&req.method==="GET")return response({notebook:withProgress(row.notebook,row.progress),account:status(row)});
    if(path==="/sync"&&req.method==="POST") {
      if(!row.has_provider_session||row.sync_state==="reauth"||row.sync_state==="paused")throw new HttpError(409,"请重新扫码后再同步。");
      if(row.last_attempt&&Date.now()-Date.parse(row.last_attempt)<120000)return response(status(row));
      await patch(TABLE,`id=eq.${row.id}`,{next_sync:now(),sync_state:"queued"});queueWork();return response({...status(row),syncState:"queued"});
    }
    if(path==="/logout"&&req.method==="POST") {await database(`xc_fb_sessions?token_hash=eq.${tokenHash}`,{method:"DELETE"});return response({ok:true});}
    if(path==="/disconnect"&&req.method==="POST") {await patch(TABLE,`id=eq.${row.id}`,{session_cipher:null,sync_state:"paused",sync_cursor:null,locked_until:null});return response({ok:true});}
    return response({error:"入口不存在。"},404);
  } catch(error) {
    if(error instanceof HttpError)return response({error:error.message},error.status);
    if(error instanceof ProviderError)return response({error:"粉笔暂时未能完成此操作，请稍后重新扫码。",category:error.code},502);
    return response({error:"云端连接暂时不可用，请稍后重试。"},503);
  }
}
if(typeof Deno!=="undefined")Deno.serve(handler);
