import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { importFenbiExport, rateMistake, updateMistakeNote } from "../src/mistakes.ts";

async function cloud(name: string): Promise<typeof import("../supabase/functions/fenbi-cloud/index.ts")> {
  return import(new URL(`../supabase/functions/fenbi-cloud/index.ts?security-test=${name}`, import.meta.url).href);
}
function notebook() {
  return importFenbiExport({ schemaVersion: 1, exportedAt: "2026-09-01T10:00:00.000Z", complete: true, scope: { subject: "synthetic" }, requestedQuestionIds: ["1"], tree: [{ name: "合成模块", questionIds: [1] }], batches: [{ solutions: [{ id: 1, content: "合成题干", correctAnswer: { choice: "0" } }], materials: [] }], answers: [] }, undefined, "2026-09-01T10:00:00.000Z").notebook;
}
function useEnvironment(t: TestContext) {
  const old = Object.getOwnPropertyDescriptor(globalThis, "Deno");
  Object.defineProperty(globalThis, "Deno", { configurable: true, value: { env: { get: (name: string) => name === "SUPABASE_URL" ? "https://synthetic-cloud.invalid" : name === "SUPABASE_SERVICE_ROLE_KEY" ? "synthetic-service-role" : undefined }, serve: () => {} } });
  t.after(() => { if (old) Object.defineProperty(globalThis, "Deno", old); else Reflect.deleteProperty(globalThis, "Deno"); });
}
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
const request = (path: string, body?: unknown, token = "a".repeat(64)) => new Request(`https://synthetic-edge.invalid/functions/v1/fenbi-cloud${path}`, {
  method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Origin: "https://xc.pithiest.cn" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
});
async function sealedTestValue(value:unknown, secret:string) {
  const bytes=new TextEncoder().encode(`xc-fenbi-session:v1:${secret}`);
  const raw=await crypto.subtle.digest("SHA-256",bytes);
  const key=await crypto.subtle.importKey("raw",raw,"AES-GCM",false,["encrypt"]);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode(JSON.stringify(value)));
  const b64=(input:Uint8Array)=>btoa(String.fromCharCode(...input));
  return `${b64(iv)}.${b64(new Uint8Array(encrypted))}`;
}

test("session token hashing is stable and never stores the original capability", async () => {
  const { digest } = await cloud("hash");
  assert.equal(await digest("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.match(await digest("a".repeat(64)), /^[a-f0-9]{64}$/);
  assert.notEqual(await digest("a".repeat(64)), "a".repeat(64));
});

test("untrusted origins, missing session tokens, and unauthenticated worker requests cannot read data", async t => {
  useEnvironment(t);
  let fetches = 0;
  t.mock.method(globalThis, "fetch", async () => { fetches++; throw new Error("Unexpected outbound request"); });
  const { handler } = await cloud("unauthorized");
  const disallowed = await handler(new Request("https://synthetic-edge.invalid/functions/v1/fenbi-cloud/notebook", { headers: { Origin: "https://untrusted.invalid" } }));
  assert.equal(disallowed.status, 403);
  const missing = await handler(new Request("https://synthetic-edge.invalid/functions/v1/fenbi-cloud/notebook"));
  assert.equal(missing.status, 401);
  const worker = await handler(new Request("https://synthetic-edge.invalid/functions/v1/fenbi-cloud/worker", { method: "POST" }));
  assert.equal(worker.status, 401);
  assert.equal(fetches, 0);
});

test("QR generation throttling keys on the platform requester IP, not spoofable X-Forwarded-For",async t=>{
  useEnvironment(t);
  const runtimeSecret="e".repeat(64),counts=new Map<string,number>();let providerCalls=0;
  t.mock.method(globalThis,"fetch",async(input,init)=>{
    const url=new URL(String(input));
    if(url.hostname==="synthetic-cloud.invalid"){
      if(url.pathname.endsWith("/rpc/xc_fb_runtime_key"))return json(runtimeSecret);
      if(url.pathname.endsWith("/xc_fb_logins")){
        if(init?.method==="POST"){
          const row=JSON.parse(String(init.body));counts.set(row.ip_hash,(counts.get(row.ip_hash)||0)+1);return json([row]);
        }
        const hash=(url.searchParams.get("ip_hash")||"").replace(/^eq\./,"");
        return json(Array.from({length:counts.get(hash)||0},(_,id)=>({id})));
      }
    }
    assert.equal(url.hostname,"ke.fenbi.com");assert.ok(url.pathname.endsWith("/gen_code"));providerCalls++;
    return json({code:1,data:{lgtoken:"synthetic-qr-token",codeContent:"synthetic-qr-content"}});
  });
  const {handler}=await cloud("qr-ip-limit");
  for(let index=0;index<30;index++){
    const response=await handler(new Request("https://synthetic-edge.invalid/functions/v1/fenbi-cloud/login/start",{method:"POST",headers:{"Content-Type":"application/json",Origin:"https://xc.pithiest.cn","cf-connecting-ip":"203.0.113.9","x-forwarded-for":`198.51.100.${index+1}`},body:"{}"}));
    assert.equal(response.status,200);
  }
  const limited=await handler(new Request("https://synthetic-edge.invalid/functions/v1/fenbi-cloud/login/start",{method:"POST",headers:{"Content-Type":"application/json",Origin:"https://xc.pithiest.cn","cf-connecting-ip":"203.0.113.9","x-forwarded-for":"192.0.2.254"},body:"{}"}));
  assert.equal(limited.status,429);assert.equal(providerCalls,30);
});

test("expired or unknown session cannot reach account rows", async t => {
  useEnvironment(t);
  const visited: string[] = [];
  t.mock.method(globalThis, "fetch", async input => {
    const url = new URL(String(input));
    visited.push(url.pathname);
    assert.match(url.search, /token_hash=eq\.[a-f0-9]{64}/);
    assert.match(url.search, /expires_at=gt\./);
    return json([]);
  });
  const { handler } = await cloud("expired");
  assert.equal((await handler(request("/notebook"))).status, 401);
  assert.deepEqual(visited, ["/rest/v1/xc_fb_sessions"]);
});

test("account polling uses the lightweight owner view without a full notebook or credentials; sync uses its session flag", async t => {
  useEnvironment(t);
  const visited: Array<{ path: string; method: string }> = [];
  let hasSession = true;
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method || "GET";
    visited.push({ path: url.pathname, method });
    if (url.pathname === "/rest/v1/xc_fb_sessions") {
      assert.equal(url.searchParams.get("select"), "account_id");
      assert.match(url.searchParams.get("token_hash") || "", /^eq\.[a-f0-9]{64}$/);
      return json([{ account_id: "account-a" }]);
    }
    assert.equal(url.searchParams.get("id"), "eq.account-a");
    if (method === "PATCH") {
      assert.equal(url.pathname, "/rest/v1/xc_fb_accounts");
      assert.equal(JSON.parse(String(init?.body)).sync_state, "queued");
      return json([{ id: "account-a" }]);
    }
    assert.equal(url.pathname, "/rest/v1/xc_fb_account_status", "status polling must not load the base account/notebook row");
    return json([{
      id: "account-a", display_name: "合成用户", source_stamp: "2026-09-01T10:00:00.000Z", progress_revision: 7,
      last_sync: "2026-09-01T10:00:00.000Z", last_attempt: null, next_sync: "2026-09-02T10:00:00.000Z", sync_state: "idle", last_error: null,
      question_count: 619, sync_loaded: 20, sync_total: 619, has_provider_session: hasSession,
      // Even an accidental future view projection must not be returned by status().
      ...(hasSession ? {} : { session_cipher: "synthetic-secret-not-for-response" }),
      provider_cookie: "synthetic-cookie-not-for-response"
    }]);
  });
  const { handler } = await cloud("lightweight-status");
  const response = await handler(request("/account?owner=account-b&accountId=account-b"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), {
    sourceStamp: "2026-09-01T10:00:00.000Z", progressRevision: 7, accountId: "account-a", displayName: "合成用户",
    lastSync: "2026-09-01T10:00:00.000Z", lastAttempt: null, nextSync: "2026-09-02T10:00:00.000Z", syncState: "idle", error: null,
    questionCount: 619, loaded: 20, total: 619, historyUpdatedAt: null, historyComplete: false, historyCount: 0, historyExcluded: 0, syncStage: "mistakes"
  });
  assert.deepEqual(visited, [
    { path: "/rest/v1/xc_fb_sessions", method: "GET" },
    { path: "/rest/v1/xc_fb_account_status", method: "GET" }
  ]);

  // A lightweight row intentionally has no session_cipher. Its boolean is sufficient.
  assert.equal((await handler(request("/sync", {}))).status, 200);
  assert.equal(visited.filter(visit => visit.method === "PATCH").length, 1);
  hasSession = false;
  const disconnected = await handler(request("/sync", {}));
  assert.equal(disconnected.status, 409, "an absent provider session cannot be bypassed with an unexpected cipher field");
  assert.equal(visited.filter(visit => visit.method === "PATCH").length, 1);
  assert.equal((await disconnected.text()).includes("synthetic-secret"), false);
});

test("progress reads bind to the session owner and fetch only progress/revision regardless of client owner parameters", async t => {
  useEnvironment(t);
  const progress = [{ id: "fenbi:1", progress: { note: "合成私人复盘", updatedAt: "2026-09-02T10:00:00.000Z" } }];
  const visited: string[] = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(String(input));
    assert.equal(init?.method || "GET", "GET");
    assert.equal(url.href.includes("account-b"), false, "client-supplied owner cannot enter the database query");
    visited.push(url.pathname);
    if (url.pathname === "/rest/v1/xc_fb_sessions") return json([{ account_id: "account-a" }]);
    assert.equal(url.searchParams.get("id"), "eq.account-a");
    if (url.pathname === "/rest/v1/xc_fb_account_status") return json([{ id: "account-a", progress_revision: 7, has_provider_session: true }]);
    assert.equal(url.pathname, "/rest/v1/xc_fb_accounts");
    assert.equal(url.searchParams.get("select"), "progress,progress_revision", "progress refresh must never transfer question content or cookies");
    assert.equal(url.searchParams.get("limit"), "1");
    return json([{ progress, progress_revision: 7, unexpectedSecret: "synthetic-private-not-for-response" }]);
  });
  const { handler } = await cloud("progress-read-binding");
  const response = await handler(request("/progress?owner=account-b&accountId=account-b&providerId=account-b"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { progress, revision: 7 });
  assert.deepEqual(visited, ["/rest/v1/xc_fb_sessions", "/rest/v1/xc_fb_account_status", "/rest/v1/xc_fb_accounts"]);
});

test("untrusted progress attaches only to known source questions and cannot inject question content", async () => {
  const { withProgress } = await cloud("attach-progress");
  const book = notebook();
  const reviewed = rateMistake(book.questions[0], "good", "2026-09-02T10:00:00.000Z");
  const attached = withProgress(book, [
    { id: "fenbi:1", progress: reviewed.progress, source: { stemHtml: "untrusted replacement" } },
    { id: "fenbi:999", progress: reviewed.progress },
    { id: "__proto__", progress: { note: "prototype replacement" } }
  ]);
  assert.equal(attached.questions.length, 1);
  assert.equal(attached.questions[0].source.stemHtml, "合成题干");
  assert.equal(attached.questions[0].progress.history.length, 1);
  const sanitized = withProgress(book, [{ id: "fenbi:1", progress: { note: { unsafe: true }, history: [{ id: "bad", rating: "execute", reviewedAt: "invalid" }], stage: "invalid" } }]);
  assert.equal(sanitized.questions[0].progress.note, "");
  assert.equal(sanitized.questions[0].progress.history.length, 0);
});

test("clearing a standalone note remains a syncable edit", async () => {
  const { progressOnly, withProgress } = await cloud("clear-note");
  const book = notebook();
  book.questions[0] = updateMistakeNote(book.questions[0], "合成旧笔记", "2026-09-02T10:00:00.000Z");
  const cleared = structuredClone(book);
  cleared.questions[0] = updateMistakeNote(cleared.questions[0], "", "2026-09-03T10:00:00.000Z");
  const payload = progressOnly(cleared);
  assert.equal(payload.length, 1, "An empty note with an edit timestamp must be sent to other devices");
  assert.equal(withProgress(book, payload).questions[0].progress.note, "");
});

test("progress writes bind to the token's account, ignore supplied account IDs, and retry revision conflicts", async t => {
  useEnvironment(t);
  const book = notebook();
  const remote = rateMistake(book.questions[0], "good", "2026-09-02T10:00:00.000Z");
  const incoming = updateMistakeNote(book.questions[0], "合成设备笔记", "2026-09-03T10:00:00.000Z");
  let accountReads = 0;
  const writes: Array<{ query: string; body: Record<string, unknown> }> = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/xc_fb_sessions")) return json([{ account_id: "account-a" }]);
    assert.equal(url.pathname, "/rest/v1/xc_fb_accounts");
    assert.equal(url.searchParams.get("id"), "eq.account-a");
    if (init?.method === "PATCH") {
      const body = JSON.parse(String(init.body));
      assert.equal(Object.prototype.hasOwnProperty.call(body, "notebook"), false);
      assert.equal(Object.prototype.hasOwnProperty.call(body, "session_cipher"), false);
      writes.push({ query: url.search, body });
      return json(writes.length === 1 ? [] : [{ id: "account-a" }]);
    }
    accountReads++;
    return json([{ id: "account-a", notebook: book, progress: accountReads > 1 ? [{ id: remote.id, progress: remote.progress }] : [], progress_revision: accountReads > 1 ? 1 : 0 }]);
  });
  const { handler } = await cloud("account-binding");
  const response = await handler(request("/progress", { accountId: "account-b", progress: [{ id: incoming.id, progress: incoming.progress }, { id: "fenbi:999", progress: incoming.progress }] }));
  assert.equal(response.status, 200);
  assert.equal(writes.length, 2);
  assert.match(writes[0].query, /progress_revision=eq\.0/);
  assert.match(writes[1].query, /progress_revision=eq\.1/);
  const result = await response.json();
  assert.equal(result.revision, 2);
  assert.equal(result.progress.length, 1);
  assert.equal(result.progress[0].progress.note, "合成设备笔记");
  assert.equal(result.progress[0].progress.history.length, 1);
});

test("concurrent QR polling consumes one challenge once and keeps provider credentials encrypted", async t => {
  useEnvironment(t);
  const runtimeSecret = "f".repeat(64);
  const cookieValue = "synthetic-private-cookie-value";
  let loginRow: Record<string, any> | null = null;
  let accountRow: Record<string, any> | null = null;
  const sessions: Record<string, any>[] = [];
  let qrPolls = 0;
  let barrier = true;
  const simultaneousReads: Array<{ value: Record<string, any> | null; resolve: (response: Response) => void }> = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "ke.fenbi.com" && url.pathname.endsWith("/gen_code")) {
      return new Response(JSON.stringify({ code: 1, data: { lgtoken: "synthetic-provider-login-token", codeContent: "synthetic-qr-content" } }), {
        headers: { "Content-Type": "application/json", "Set-Cookie": `synthetic_cookie=${cookieValue}; Domain=.fenbi.com; Path=/; Secure; HttpOnly` }
      });
    }
    if (url.hostname === "ke.fenbi.com" && url.pathname.endsWith("/query_code_status")) {
      qrPolls++;
      assert.match(new Headers(init?.headers).get("Cookie") || "", /synthetic_cookie=/);
      assert.equal(new Headers(init?.headers).get("Authorization"), null);
      return json({ code: 1, data: 3 });
    }
    if (url.hostname === "login.fenbi.com" && url.pathname === "/api/users/info") return json({ userId: 12345, identity: "合成用户" });
    assert.equal(url.hostname, "synthetic-cloud.invalid", "Unexpected host must not receive test credentials");
    if (url.pathname.endsWith("/rpc/xc_fb_runtime_key")) return json(runtimeSecret);
    if (url.pathname.endsWith("/xc_fb_logins")) {
      if (init?.method === "POST") {
        loginRow = { ...JSON.parse(String(init.body)), id: "synthetic-challenge-row", last_poll_at: null };
        assert.equal(JSON.stringify(loginRow).includes(cookieValue), false);
        assert.equal(JSON.stringify(loginRow).includes("synthetic-provider-login-token"), false);
        assert.match(loginRow.state_cipher, /^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
        return json([loginRow]);
      }
      if (init?.method === "PATCH" || init?.method === "DELETE") {
        const expected = url.searchParams.get("last_poll_at");
        const matches = loginRow && (!expected || (expected === "is.null" ? loginRow.last_poll_at == null : `eq.${loginRow.last_poll_at}` === expected));
        if (!matches) return json([]);
        if (init.method === "DELETE") { const consumed = loginRow; loginRow = null; return json([consumed]); }
        loginRow = { ...loginRow, ...JSON.parse(String(init.body)) };
        return json([loginRow]);
      }
      if (url.searchParams.has("ip_hash")) return json([]);
      assert.ok(url.searchParams.get("token_hash")?.startsWith("eq."));
      const snapshot = loginRow ? structuredClone(loginRow) : null;
      if (barrier) return new Promise<Response>(resolve => {
        simultaneousReads.push({ value: snapshot, resolve });
        if (simultaneousReads.length === 2) {
          barrier = false;
          simultaneousReads.forEach(read => read.resolve(json(read.value ? [read.value] : [])));
        }
      });
      return json(snapshot ? [snapshot] : []);
    }
    if (url.pathname.endsWith("/xc_fb_accounts") && init?.method === "POST") {
      assert.equal(accountRow, null, "The losing QR poll cannot create another account session");
      accountRow = { ...JSON.parse(String(init.body)), id: "account-a" };
      assert.equal(JSON.stringify(accountRow).includes(cookieValue), false);
      assert.match(accountRow.session_cipher, /^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
      return json([accountRow]);
    }
    if (url.pathname.endsWith("/xc_fb_sessions") && init?.method === "POST") {
      sessions.push(JSON.parse(String(init.body)));
      return json([sessions[sessions.length - 1]]);
    }
    throw new Error(`Unexpected synthetic route: ${url.pathname}`);
  });
  const { handler, digest } = await cloud("qr-concurrency");
  const startedResponse = await handler(request("/login/start", {}));
  assert.equal(startedResponse.status, 200);
  const started = await startedResponse.json();
  assert.match(started.challenge, /^[a-f0-9]{64}$/);
  const responses = await Promise.all([
    handler(request("/login/poll", { challenge: started.challenge })),
    handler(request("/login/poll", { challenge: started.challenge }))
  ]);
  const results = await Promise.all(responses.map(response => response.json()));
  const successful = results.filter(result => result.status === 3);
  assert.equal(successful.length, 1);
  assert.equal(qrPolls, 1, "Only the CAS winner polls the provider");
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].account_id, "account-a");
  assert.equal(sessions[0].token_hash, await digest(successful[0].token));
  assert.notEqual(sessions[0].token_hash, successful[0].token);
  assert.equal(loginRow, null);
  const replay = await handler(request("/login/poll", { challenge: started.challenge }));
  assert.equal(replay.status, 410);
  assert.equal(sessions.length, 1);

  const secondStart = await handler(request("/login/start", {}));
  const secondChallenge = await secondStart.json();
  assert.ok(loginRow);
  const [iv, ciphertext] = loginRow.state_cipher.split(".");
  loginRow.state_cipher = `${iv}.${ciphertext[0] === "A" ? "B" : "A"}${ciphertext.slice(1)}`;
  const tampered = await handler(request("/login/poll", { challenge: secondChallenge.challenge }));
  assert.equal(tampered.status, 503, "Modified AES-GCM ciphertext must fail authentication before provider access");
  assert.equal(qrPolls, 1);
  assert.equal(sessions.length, 1);
  assert.equal((await tampered.text()).includes(cookieValue), false);
});

test("practice pagination, questions, and review writes are scoped by authenticated account, never caller owner IDs", async t => {
 useEnvironment(t);
 t.mock.method(globalThis,"fetch",async (input,init)=>{
  const url=new URL(String(input));
  if(url.pathname.endsWith("xc_fb_sessions"))return json([{account_id:"account-a"}]);
  if(url.pathname.endsWith("xc_fb_account_status"))return json([{id:"account-a"}]);
  assert.equal(url.searchParams.get("account_id"),"eq.account-a");
  assert.ok(url.pathname.endsWith("xc_fb_exercises"));
  return json([]);
 });
 const {handler}=await cloud("practice-owner");
 const list=await handler(request("/practice?accountId=account-b"));assert.equal(list.status,200);assert.deepEqual((await list.json()).items,[]);
 assert.equal((await handler(request("/practice?offset=-1"))).status,400);
 assert.equal((await handler(request("/practice/question?exercise=other&question=1&accountId=account-b"))).status,404);
 assert.equal((await handler(request("/practice/review",{key:"other",accountId:"account-b"}))).status,404);
});

test("malformed completed-history page keeps its prior checkpoint and never marks the history complete",async t=>{
  useEnvironment(t);
  const runtimeSecret="c".repeat(64),historyCursor={category:0,cursor:"",pending:[],next:null,seenCursors:[],seenKeys:[],excluded:[],pages:0};
  const lockedUntil=new Date(Date.now()+180000).toISOString();
  const row={id:"account-a",locked_until:lockedUntil,session_cipher:await sealedTestValue({cookies:[]},runtimeSecret),sync_cursor:{stage:"history"},history_cursor:historyCursor,history_complete:false,history_count:4,history_excluded:0};
  const accountPatches:Record<string,unknown>[]=[];let exerciseWrites=0;
  t.mock.method(globalThis,"fetch",async(input,init)=>{
    const url=new URL(String(input));
    if(url.hostname==="synthetic-cloud.invalid"){
      if(url.pathname.endsWith("/rpc/xc_fb_runtime_key"))return json(runtimeSecret);
      if(url.pathname.endsWith("/rpc/xc_fb_claim_job"))return json([row]);
      if(url.pathname.endsWith("/xc_fb_accounts")){
        if(init?.method==="PATCH"){accountPatches.push(JSON.parse(String(init.body)));return json([{id:"account-a"}]);}
        return json([{id:"account-a"}]);
      }
      if(url.pathname.endsWith("/xc_fb_exercises")){exerciseWrites++;return json([]);}
    }
    assert.equal(url.hostname,"tiku.fenbi.com");assert.ok(url.pathname.endsWith("getExerciseBriefHistory"));
    return json({code:1,data:{historyItems:[{exerciseKey:"synthetic-exercise",updatedTime:1780000000000}],cursor:null}});
  });
  const {workOne}=await cloud("history-checkpoint");
  const result=await workOne();
  assert.equal(result.complete,false);assert.equal(result.failure,"INVALID_RESPONSE");assert.equal(exerciseWrites,0);
  assert.equal(accountPatches.length,2);
  assert.deepEqual(accountPatches[0].history_cursor,historyCursor);
  assert.equal(accountPatches[0].history_complete,false);
  assert.deepEqual(accountPatches[1].sync_cursor,{stage:"history"});
});
