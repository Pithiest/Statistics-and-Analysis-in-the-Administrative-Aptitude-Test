import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import {createPortal} from "react-dom";
import { Cloud, CloudOff, RefreshCw } from "./icons";
import { MistakesView } from "./MistakesView";
import { emptyMistakeNotebook, exportMistakeNotebook, mergeMistakeNotebooks, normalizeMistakeNotebook, parseMistakeImport } from "./mistakes";
import type { MistakeNotebook, MistakeQuestion } from "./mistakes";
import { readNotebook, writeNotebook } from "./mistakeStorage";
import {
  disconnectFenbi, fenbiHealth, FENBI_SESSION_KEY, getFenbiAccount, getFenbiNotebook, getFenbiProgress, isFenbiSession, logoutFenbi,
  mistakeErrorMessage, MistakeApiError, pauseFenbiSession, pollFenbiLogin, readFenbiSession, saveFenbiProgress,
  startFenbiLogin, storeFenbiSession, syncFenbiNow, verifyFenbiDevice,
} from "./mistakeApi";
import type { FenbiAccount, FenbiLoginChallenge, FenbiProgress, FenbiSession } from "./mistakeApi";
import { collectFenbiBrowserExtras, FENBI_STARTUP_ID, hasAttemptedFenbiDevice, markFenbiDeviceAttempt } from "./fenbiDevice";
import { getSharedFenbiSession, logoutSharedFenbi, pollSharedFenbiLogin, startSharedFenbiLogin } from "./sharedFenbiAuth";
import "./mistakes.css";

const ANONYMOUS_KEY = "anonymous-local-imports";
const PULL_INTERVAL = 120_000;
const PROGRESS_DELAY = 5_000;

function localTime(value: string | null | undefined) {
  if (!value) return "尚未同步";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "尚未同步" : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}
type CloudVersion = { sourceStamp: string; progressRevision: number };
function cloudVersion(account: FenbiAccount): CloudVersion | null {
  return typeof account.progressRevision === "number" && Number.isSafeInteger(account.progressRevision) && account.progressRevision >= 0
    ? { sourceStamp: account.sourceStamp ?? account.lastSync ?? "", progressRevision: account.progressRevision } : null;
}
function sameVersion(left: CloudVersion | null, right: CloudVersion | null) {
  return left !== null && right !== null && left.sourceStamp === right.sourceStamp && left.progressRevision === right.progressRevision;
}
function returnedRevision(value: string | number, fallback: number) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}
function progressSignature(progress: MistakeQuestion["progress"]) { return JSON.stringify(progress); }
function equalNotebook(a: MistakeNotebook, b: MistakeNotebook) { return JSON.stringify(a) === JSON.stringify(b); }
function downloadNotebook(notebook: MistakeNotebook) {
  const url = URL.createObjectURL(new Blob([exportMistakeNotebook(notebook)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `xingce-mistakes-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function parseFile(file: File, existing: MistakeNotebook) {
  if (file.size > 40_000_000) throw new Error("文件大于 40 MB，请使用较小的错题导出文件。");
  return parseMistakeImport(await file.text(), existing);
}

/** Serial writes keep a slow earlier IndexedDB transaction from replacing a newer edit. */
function useLocalNotebook(key: string) {
  const [notebook, setNotebook] = useState<MistakeNotebook>(emptyMistakeNotebook);
  const notebookRef = useRef(notebook);
  const [ready, setReady] = useState(false);
  const [readAttempt, setReadAttempt] = useState(0);
  const [storageError, setStorageError] = useState("");
  const alive = useRef(true);
  const saveQueue = useRef<Promise<boolean>>(Promise.resolve(true));
  const revision = useRef(0);
  useEffect(() => {
    alive.current = true;
    let current = true;
    void readNotebook(key).then((stored) => {
      if (!current) return;
      const book = stored ? normalizeMistakeNotebook(stored) : emptyMistakeNotebook();
      notebookRef.current = book; setNotebook(book); setStorageError(""); setReady(true);
    }).catch(() => { if (current) setStorageError("本机错题未能读取，已暂停自动写入以保留原记录。请重试；恢复前不要清除浏览器数据。"); });
    return () => { current = false; alive.current = false; };
  }, [key, readAttempt]);
  const commit = useCallback((next: MistakeNotebook) => {
    if (equalNotebook(notebookRef.current, next)) return;
    notebookRef.current = next; setNotebook(next);
    const writingRevision = ++revision.current;
    saveQueue.current = saveQueue.current.then(() => writeNotebook(key, next)).then(() => {
      if (alive.current && writingRevision === revision.current) setStorageError("");
      return true;
    }).catch(() => {
      if (alive.current) setStorageError("这次修改未能保存到本机，请立即导出备份。不要关闭或刷新当前页面。");
      return false;
    });
  }, [key]);
  return { notebook, notebookRef, ready, storageError, commit, saveQueue, retryRead: () => setReadAttempt((value) => value + 1) };
}

type Presentation = { mode: "settings" | "review" | "background"; onSettings: () => void };

export function MistakesWorkspace({mode,onSettings}: Presentation) {
  const [target,setTarget]=useState<HTMLElement|null>(null);
  useEffect(()=>{
    const id=mode==="settings"?"fenbi-settings-slot":mode==="review"?"fenbi-review-slot":"";
    const update=()=>setTarget(id?document.getElementById(id):null);update();
    const observer=new MutationObserver(update);observer.observe(document.body,{childList:true,subtree:true});return()=>observer.disconnect();
  },[mode]);
  const [session, setSession] = useState<FenbiSession | null>(readFenbiSession);
  const sessionRef = useRef(session);
  const sessionRevision = useRef(0);
  const [message, setMessage] = useState("");
  const [sessionStorageError, setSessionStorageError] = useState("");
  const [sharedCandidate, setSharedCandidate] = useState<{session:FenbiSession;account:FenbiAccount;previous:FenbiSession}|null>(null);
  const sharedCandidateRef = useRef(sharedCandidate);
  sharedCandidateRef.current = sharedCandidate;
  const [sharedError, setSharedError] = useState("");
  const [logoutBusy, setLogoutBusy] = useState(false);
  const logoutInFlight = useRef(false);
  const sharedCheckBusy = useRef(false);
  const hadSession = useRef(Boolean(session));
  const suppressNextRestore = useRef(false);
  const finishLogin = (next: FenbiSession) => {
    if (!isFenbiSession(next)) { setMessage("本次登录没有完成，请重新扫码。"); return; }
    if (!storeFenbiSession(next)) { const warning="浏览器未能保存登录状态，请检查存储权限后重试；原记录仍保留。";setSessionStorageError(warning);setSharedError(warning);return; }
    setSessionStorageError("");setSharedCandidate(null);setSharedError("");
    ++sessionRevision.current; sessionRef.current = next; setMessage(""); setSession(next);
  };
  const restoreShared = async (signal?: AbortSignal) => {
    if (!navigator.onLine || logoutInFlight.current || sharedCandidateRef.current || sharedCheckBusy.current) return;
    sharedCheckBusy.current = true;
    try {
      const result = await getSharedFenbiSession(signal);
      if (signal?.aborted || logoutInFlight.current || sharedCandidateRef.current || !result) return;
      setSharedError("");
      const current = sessionRef.current;
      if (current?.accountId === result.session.accountId) return;
      if (current) {
        const candidate = { ...result, previous: current };
        sharedCandidateRef.current = candidate;setSharedCandidate(candidate);
        suppressNextRestore.current = true;
        pauseFenbiSession();
        sessionRef.current = null;setSession(null);
      }
      else finishLogin(result.session);
    } catch (failure) {
      if (!signal?.aborted && !sessionRef.current) setSharedError(mistakeErrorMessage(failure));
    } finally { sharedCheckBusy.current = false; }
  };
  useEffect(() => {
    const controller = new AbortController();
    void restoreShared(controller.signal);
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const checkOnReturn = () => { if (!document.hidden) void restoreShared(controller.signal); };
    window.addEventListener("focus", checkOnReturn);
    document.addEventListener("visibilitychange", checkOnReturn);
    return () => { controller.abort();window.removeEventListener("focus", checkOnReturn);document.removeEventListener("visibilitychange", checkOnReturn); };
  }, []);
  useEffect(() => {
    const wasConnected = hadSession.current;
    hadSession.current = Boolean(session);
    if (wasConnected && !session) {
      if (suppressNextRestore.current) suppressNextRestore.current = false;
      else void restoreShared();
    }
  }, [session]);
  const clearSession = (current: FenbiSession, expired = false) => {
    if (sessionRef.current?.token !== current.token) return;
    ++sessionRevision.current; sessionRef.current = null;
    if (!storeFenbiSession(null)) setSessionStorageError("本机登录状态未能清除，请在浏览器设置中检查存储权限。");
    setMessage(expired ? "登录已失效，请重新扫码。原账号的本机错题和复盘记录仍保留，登录同一账号即可继续。" : "已退出。原账号的本机复盘记录仍保留；以下仅显示未登录时单独导入的错题。");
    setSession(null);
  };
  const logout = async (current: FenbiSession) => {
    if (logoutInFlight.current) return;
    logoutInFlight.current = true;setLogoutBusy(true);setSharedError("");
    try {
      await logoutSharedFenbi();
      try { await logoutFenbi(current.token); } catch (failure) {
        if (!(failure instanceof MistakeApiError && failure.status === 401)) throw failure;
      }
      if (sessionRef.current?.token === current.token) { suppressNextRestore.current = true; clearSession(current); }
      setSharedCandidate(null);
    } catch (failure) {
      setSharedError(`云端退出未完成，账号仍保持登录，请重试。${mistakeErrorMessage(failure)}`);
    } finally { logoutInFlight.current = false;setLogoutBusy(false); }
  };
  useEffect(() => {
    const changedElsewhere = (event: StorageEvent) => {
      if (event.key !== FENBI_SESSION_KEY && event.key !== null) return;
      const next = readFenbiSession();
      if (next?.token === sessionRef.current?.token) return;
      ++sessionRevision.current; sessionRef.current = next; setSession(next);
      setMessage(next ? "" : "账号已在另一页面退出，原账号复盘记录仍保留在本机。");
    };
    const samePage=()=>{const next=readFenbiSession();if(next?.token!==sessionRef.current?.token){++sessionRevision.current;sessionRef.current=next;setSession(next);}};
    window.addEventListener("fenbi-session-change",samePage);
    window.addEventListener("storage", changedElsewhere);
    return () => {window.removeEventListener("storage", changedElsewhere);window.removeEventListener("fenbi-session-change",samePage);};
  }, []);
  const portal=(content:React.ReactNode)=>target?createPortal(content,target):null;
  const conflictTarget=document.getElementById("shared-identity-slot");
  return <>
    {conflictTarget && (sharedCandidate || sharedError) && createPortal(<div className="notice-banner is-warning shared-identity-notice" role="alert"><div><strong>{sharedCandidate?"两站当前连接的粉笔账号不同":"共享账号操作未完成"}</strong><span>{sharedCandidate?`行测已暂停原账号读取；公专连接的是「${sharedCandidate.account.displayName||"另一个账号"}」。请选择要在行测使用的账号。${sharedError?` ${sharedError}`:""}`:sharedError}</span></div>{sharedCandidate && <div className="button-row"><button className="primary-btn" onClick={()=>finishLogin(sharedCandidate.session)}>切换到公专账号</button><button className="soft-btn" onClick={()=>finishLogin(sharedCandidate.previous)}>继续原行测账号</button></div>}</div>,conflictTarget)}
    {target && sessionStorageError && <div className="mistake-storage-warning" role="alert">{sessionStorageError}</div>}
    {session ? <AccountNotebook key={`${session.accountId}:${session.token}`} session={session} mode={mode} onSettings={onSettings} portal={portal} logoutBusy={logoutBusy}
      onExpired={() => clearSession(session, true)} onLogout={() => void logout(session)} onReconnect={() => clearSession(session, true)} />
      : sharedCandidate ? portal(<div className="panel mistake-cloud-loading" role="status">请先在页面上方选择要使用的粉笔账号，原账号的读取已暂停。</div>)
      : <AnonymousNotebook key="anonymous" message={message} onLogin={finishLogin} mode={mode} onSettings={onSettings} portal={portal} />}
  </>;
}

function StorageWarning({ message, notebook, onRetry }: { message: string; notebook: MistakeNotebook; onRetry?: () => void }) {
  if (!message) return null;
  return <div className="mistake-storage-warning" role="alert"><span>{message}</span>{onRetry ? <button className="soft-btn" type="button" onClick={onRetry}>重试读取</button> : <button className="soft-btn" type="button" onClick={() => downloadNotebook(notebook)}>导出当前备份</button>}</div>;
}

function AnonymousNotebook({ message, onLogin, mode,onSettings,portal }: { message: string; onLogin: (session: FenbiSession) => void; portal:(node:React.ReactNode)=>React.ReactNode } & Presentation) {
  const local = useLocalNotebook(ANONYMOUS_KEY);
  const [importNotice, setImportNotice] = useState("");
  const [importError, setImportError] = useState("");
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const importFile = async (file: File) => {
    try {
      const result = await parseFile(file, local.notebookRef.current);
      if (!alive.current) return;
      local.commit(mergeMistakeNotebooks(local.notebookRef.current, result.notebook)); setImportError("");
      setImportNotice(`已导入：新增 ${result.summary.added} 题，更新 ${result.summary.updated} 题。这份错题本仅保存在当前浏览器，登录后不会自动混入任何账号。`);
    } catch { if (alive.current) setImportError("文件未能导入，请选择插件导出或本网站备份的错题 JSON，且不超过 40 MB。"); }
  };
  const connection = <div className="stack">
    {mode==="settings" ? <LoginPanel onLogin={onLogin} message={message} /> : <div className="notice-banner"><span>在设置连接粉笔账号，自动同步全部练习与错题。</span><button className="soft-btn" onClick={onSettings}>前往设置</button></div>}
    {importNotice && <div className="mistake-cloud-notice" role="status">{importNotice}</div>}
    {importError && <div className="mistake-storage-warning" role="alert">{importError}</div>}
    <StorageWarning message={local.storageError} notebook={local.notebook} onRetry={!local.ready ? local.retryRead : undefined} />
  </div>;
  if(mode==="background")return null;
  if(mode==="settings")return portal(connection);
  if (!local.ready) return portal(<div className="stack">{connection}<div className="panel mistake-cloud-loading" role="status">{local.storageError ? "读取恢复后即可继续使用，原本机记录保持不变。" : "正在读取本机错题…"}</div></div>);
  return portal(<MistakesView notebook={local.notebook} onChange={local.commit} onImport={importFile} onExport={() => downloadNotebook(local.notebookRef.current)} connectionSlot={connection} />);
}

function LoginPanel({ onLogin, message }: { onLogin: (session: FenbiSession) => void; message: string }) {
  const [loginMode, setLoginMode] = useState<"shared"|"legacy">("shared");
  const [challenge, setChallenge] = useState<FenbiLoginChallenge | null>(null);
  const [qrImage, setQrImage] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"idle" | "waiting" | "confirm" | "expired" | "error">("idle");
  const [error, setError] = useState("");
  const [healthError, setHealthError] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const generation = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const loginCallback = useRef(onLogin);
  loginCallback.current = onLogin;
  useEffect(() => {
    const request = new AbortController();
    void fenbiHealth(request.signal).catch(() => { if (!request.signal.aborted) setHealthError(true); });
    return () => { request.abort(); ++generation.current; activeRequest.current?.abort(); };
  }, []);
  const begin = async () => {
    const version = ++generation.current;
    activeRequest.current?.abort();
    const request = new AbortController(); activeRequest.current = request;
    setBusy(true); setError(""); setChallenge(null); setQrImage(""); setStatus("idle");
    try {
      const result = await (loginMode==="shared"?startSharedFenbiLogin:startFenbiLogin)(request.signal);
      if (!result.challenge || typeof result.codeContent !== "string" || !result.codeContent || result.codeContent.length > 20_000) throw new Error("invalid challenge");
      const image = await QRCode.toDataURL(result.codeContent, { width: 220, margin: 2, errorCorrectionLevel: "M", color: { dark: "#142239", light: "#ffffff" } });
      if (version !== generation.current || request.signal.aborted) return;
      setChallenge(result); setQrImage(image); setStatus("waiting"); setHealthError(false);
    } catch (failure) {
      if (version === generation.current && !request.signal.aborted) { setError(mistakeErrorMessage(failure)); setStatus("error"); }
    } finally { if (version === generation.current) setBusy(false); }
  };
  useEffect(() => {
    if (!challenge) return;
    const version = generation.current;
    const controller = activeRequest.current;
    if (!controller) return;
    const rawExpiry = typeof challenge.expiresAt === "number" ? challenge.expiresAt : Date.parse(challenge.expiresAt);
    const expiry = Number.isFinite(rawExpiry) ? (rawExpiry < 1e12 ? rawExpiry * 1000 : rawExpiry) : Date.now() + 180_000;
    let stopped = false;
    let pollTimer: ReturnType<typeof setTimeout>;
    const updateRemaining = () => {
      const remaining = Math.max(0, Math.ceil((expiry - Date.now()) / 1000));
      setSeconds(remaining);
      if (!remaining) { stopped = true; controller.abort(); setStatus("expired"); }
    };
    updateRemaining();
    const clock = setInterval(updateRemaining, 1000);
    const poll = async () => {
      if (stopped || controller.signal.aborted || generation.current !== version) return;
      try {
        const result = await (loginMode==="shared"?pollSharedFenbiLogin:pollFenbiLogin)(challenge.challenge, controller.signal);
        if (stopped || controller.signal.aborted || generation.current !== version) return;
        if (result.status === 3) {
          const session = { token: result.token, accountId: result.account?.accountId };
          if (!isFenbiSession(session)) throw new Error("incomplete login");
          stopped = true; clearInterval(clock); loginCallback.current(session); return;
        }
        if (result.status === 1 || result.status === 2) setStatus(result.status === 2 ? "confirm" : "waiting");
        else {
          stopped = true; clearInterval(clock);
          setStatus(result.status === 0 ? "expired" : "error");
          setError(result.status === 4 ? "你已取消登录，需要时可重新生成二维码。" : result.status === 0 ? "" : "本次扫码未能完成，请稍后重新生成二维码。");
          return;
        }
        pollTimer = setTimeout(poll, 2000);
      } catch (failure) {
        if (stopped || controller.signal.aborted || generation.current !== version) return;
        stopped = true; clearInterval(clock); setError(mistakeErrorMessage(failure)); setStatus("error");
      }
    };
    pollTimer = setTimeout(poll, 2000);
    return () => { stopped = true; clearTimeout(pollTimer); clearInterval(clock); };
  }, [challenge,loginMode]);
  const changeMode = () => {
    activeRequest.current?.abort();++generation.current;
    setChallenge(null);setQrImage("");setStatus("idle");setError("");setBusy(false);
    setLoginMode(mode=>mode==="shared"?"legacy":"shared");
  };
  return <section className="panel mistake-login-panel">
    <div className="mistake-login-copy"><span className="mistake-eyebrow">粉笔账号 · 自动同步</span><h3>{loginMode==="shared"?"扫码一次，两科目都能使用":"独立连接行测粉笔账号"}</h3><p>每位同学使用自己的粉笔账号。完成的练习、正确题、错题与实际用时由云端读取，你在这里的笔记和复习安排独立保存，不会更改粉笔里的作答。</p>
      {message && <p className="mistake-login-message" role="status">{message}</p>}
      <ul><li>用粉笔 App 扫码，在手机确认登录。{loginMode==="shared"?"确认后行测与公专会使用同一粉笔身份。":"此回退方式只连接行测站。"}</li><li>正在同一部手机上使用？可在电脑或另一块屏幕上打开本页扫码。</li><li>未登录时导入的本机错题，不会自动并入账号。</li></ul>
      <a href="https://www.fenbi.com/" target="_blank" rel="noopener noreferrer">打开粉笔官网 <span aria-hidden="true">↗</span></a>
    </div>
    <div className="mistake-login-action">
      {qrImage && (status === "waiting" || status === "confirm") ? <>
        <img src={qrImage} alt="用粉笔 App 扫描的登录二维码" width="220" height="220" />
        <strong role="status">{status === "confirm" ? "已扫码，请在手机确认登录" : "用粉笔 App 扫码"}</strong><span>{seconds} 秒后失效</span>
        <button className="mistake-text-button" type="button" onClick={begin}>重新生成二维码</button>
      </> : <>
        <div className="mistake-login-symbol"><Cloud /></div>
        {status === "expired" && <p role="status">二维码已过期，重新生成即可。</p>}
        <button className="primary-btn" type="button" disabled={busy} onClick={begin}>{busy ? "正在准备二维码…" : "生成登录二维码"}</button>
        <span>请只确认自己发起的登录</span>
      </>}
      {error && <p className="mistake-cloud-error" role="alert">{error}</p>}
      {healthError && !error && <p className="mistake-cloud-error">同步服务暂时未连接，可以稍后重试，或先导入本机错题。</p>}
      <button className="mistake-text-button" type="button" onClick={changeMode}>{loginMode==="shared"?"统一连接暂不可用？使用行测独立扫码":"返回两科目通用扫码"}</button>
    </div>
  </section>;
}

function AccountNotebook({ session, onExpired, onLogout, onReconnect,logoutBusy,mode,onSettings,portal }: { session: FenbiSession; onExpired: () => void; onLogout: () => void; onReconnect: () => void; logoutBusy:boolean; portal:(node:React.ReactNode)=>React.ReactNode } & Presentation) {
  const local = useLocalNotebook(session.accountId);
  const [account, setAccount] = useState<FenbiAccount | null>(null);
  const accountRef = useRef<FenbiAccount | null>(null);
  const [cloudError, setCloudError] = useState("");
  const [notice, setNotice] = useState("");
  const [online, setOnline] = useState(() => navigator.onLine);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [actionBusy, setActionBusy] = useState(false);
  const [deviceAttempted, setDeviceAttempted] = useState(() => hasAttemptedFenbiDevice(session.token));
  const deviceAttemptedRef = useRef(deviceAttempted);
  const [deviceMessage, setDeviceMessage] = useState("");
  const [pendingImport, setPendingImport] = useState<Awaited<ReturnType<typeof parseFile>> | null>(null);
  const lifetime = useRef(new AbortController());
  const active = useRef(true);
  const pulling = useRef(false);
  const uploading = useRef(false);
  const cloudProgress = useRef(new Map<string, string>());
  const cloudVersionRef = useRef<CloudVersion | null>(null);
  const lastPullAttempt = useRef(0);
  const accountPolling = useRef(false);
  const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentActions = useRef<{ pull: (force?: boolean) => Promise<void>; pollAccount: () => Promise<void>; flush: () => Promise<void> }>({ pull: async () => {}, pollAccount: async () => {}, flush: async () => {} });
  const callbacks = useRef({ onExpired, onLogout, onReconnect });
  callbacks.current = { onExpired, onLogout, onReconnect };
  const valid = () => active.current && !lifetime.current.signal.aborted;
  const applyAccount = (value: FenbiAccount) => {
    if (!value || value.accountId !== session.accountId) throw new MistakeApiError("账号状态发生变化，请重新扫码登录。", 401);
    accountRef.current = value; setAccount(value);
  };
  const handleError = (failure: unknown) => {
    if (!valid()) return;
    if (failure instanceof MistakeApiError && failure.status === 401) { callbacks.current.onExpired(); return; }
    setCloudError(mistakeErrorMessage(failure));
  };
  const changedProgress = (): FenbiProgress[] => local.notebookRef.current.questions
    .filter((q) => cloudProgress.current.has(q.id) && cloudProgress.current.get(q.id) !== progressSignature(q.progress))
    .map((q) => ({ id: q.id, progress: q.progress }));
  const scheduleProgress = () => {
    const count = changedProgress().length; setPendingCount(count);
    if (progressTimer.current) clearTimeout(progressTimer.current);
    if (count && navigator.onLine) progressTimer.current = setTimeout(() => void currentActions.current.flush(), PROGRESS_DELAY);
  };
  const mergeRemoteProgress = (progress: FenbiProgress[]) => {
    const received = new Map(progress.map((entry) => [entry.id, entry.progress]));
    const remoteProgressBook = normalizeMistakeNotebook({ ...local.notebookRef.current, questions: local.notebookRef.current.questions.filter((q) => received.has(q.id) && cloudProgress.current.has(q.id)).map((q) => ({ ...q, progress: received.get(q.id) })) });
    for (const q of remoteProgressBook.questions) cloudProgress.current.set(q.id, progressSignature(q.progress));
    local.commit(mergeMistakeNotebooks(local.notebookRef.current, remoteProgressBook));
  };
  const pull = async (force = false, knownAccount?: FenbiAccount) => {
    if (!valid() || !local.ready || pulling.current || !navigator.onLine || (!force && Date.now() - lastPullAttempt.current < PULL_INTERVAL)) return;
    lastPullAttempt.current = Date.now(); pulling.current = true; setLoading(true);
    try {
      const latest = knownAccount ?? await getFenbiAccount(session.token, lifetime.current.signal);
      if (!valid()) return;
      applyAccount(latest);
      const version = cloudVersion(latest);
      if (sameVersion(version, cloudVersionRef.current)) {
        setCloudError(""); scheduleProgress(); return;
      }
      if (version && cloudVersionRef.current?.sourceStamp === version.sourceStamp) {
        const result = await getFenbiProgress(session.token, lifetime.current.signal);
        if (!valid()) return;
        if (!Array.isArray(result.progress)) throw new Error("missing progress");
        mergeRemoteProgress(result.progress);
        cloudVersionRef.current = { ...version, progressRevision: returnedRevision(result.revision, version.progressRevision) };
      } else {
        const result = await getFenbiNotebook(session.token, lifetime.current.signal);
        if (!valid()) return;
        if (!result.notebook || result.notebook.schemaVersion !== 1 || !Array.isArray(result.notebook.questions)) throw new Error("incomplete notebook");
        applyAccount(result.account);
        const remote = normalizeMistakeNotebook(result.notebook);
        cloudProgress.current = new Map(remote.questions.map((q) => [q.id, progressSignature(q.progress)]));
        local.commit(mergeMistakeNotebooks(local.notebookRef.current, remote));
        cloudVersionRef.current = cloudVersion(result.account) ?? version;
      }
      setCloudError(""); scheduleProgress();
    } catch (failure) { handleError(failure); }
    finally { pulling.current = false; if (valid()) setLoading(false); }
  };
  const flush = async () => {
    if (!valid() || !local.ready || uploading.current || !navigator.onLine) return;
    uploading.current = true;
    try {
      await local.saveQueue.current;
      if (!valid()) return;
      const changes = changedProgress();
      if (!changes.length) { setPendingCount(0); return; }
      setSending(true);
      const result = await saveFenbiProgress(session.token, changes, lifetime.current.signal);
      if (!valid()) return;
      if (!Array.isArray(result.progress) || changes.some((change) => !result.progress.some((entry) => entry.id === change.id))) throw new Error("missing progress");
      mergeRemoteProgress(result.progress);
      if (cloudVersionRef.current) cloudVersionRef.current = { ...cloudVersionRef.current, progressRevision: returnedRevision(result.revision, cloudVersionRef.current.progressRevision) };
      setCloudError(""); scheduleProgress();
    } catch (failure) { handleError(failure); if (valid()) setPendingCount(changedProgress().length); }
    finally { uploading.current = false; if (valid()) setSending(false); }
  };
  const pollAccount = async () => {
    if (!valid() || accountPolling.current || !navigator.onLine) return;
    accountPolling.current = true;
    try {
      const next = await getFenbiAccount(session.token, lifetime.current.signal);
      if (!valid()) return;
      const version = cloudVersion(next);
      const changed = version ? !sameVersion(version, cloudVersionRef.current) : next.lastSync !== accountRef.current?.lastSync;
      applyAccount(next);
      if (changed || Date.now() - lastPullAttempt.current >= PULL_INTERVAL) await pull(changed, next);
    } catch (failure) { handleError(failure); }
    finally { accountPolling.current = false; }
  };
  currentActions.current = { pull, pollAccount, flush };
  useEffect(() => {
    active.current = true;
    lifetime.current = new AbortController();
    return () => { active.current = false; lifetime.current.abort(); if (progressTimer.current) clearTimeout(progressTimer.current); };
  }, []);
  useEffect(() => {
    if (!local.ready) return;
    void currentActions.current.pull(true);
    const polling = setInterval(() => {
      if (document.hidden) return;
      if (accountRef.current?.syncState === "queued" || accountRef.current?.syncState === "syncing") void currentActions.current.pollAccount();
      else if (Date.now() - lastPullAttempt.current >= PULL_INTERVAL) void currentActions.current.pull();
    }, 5000);
    const onVisibility = () => { if (!document.hidden) { void currentActions.current.pollAccount(); void currentActions.current.flush(); } };
    const onOnline = () => { setOnline(true); void currentActions.current.pull(true); };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline); window.addEventListener("offline", onOffline); document.addEventListener("visibilitychange", onVisibility);
    return () => { clearInterval(polling); window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); document.removeEventListener("visibilitychange", onVisibility); };
  }, [local.ready]);
  const changeNotebook = (next: MistakeNotebook) => { local.commit(next); scheduleProgress(); };
  const importFile = async (file: File) => {
    try { const result = await parseFile(file, local.notebookRef.current); if (valid()) { setPendingImport(result); setCloudError(""); } }
    catch { if (valid()) setCloudError("文件未能导入，请选择插件导出或本网站备份的错题 JSON，且不超过 40 MB。"); }
  };
  const confirmImport = () => {
    if (!pendingImport) return;
    // Re-merge here so edits made while the confirmation was open are retained.
    changeNotebook(mergeMistakeNotebooks(local.notebookRef.current, pendingImport.notebook));
    setNotice(`已在当前账号的本机错题本导入 ${pendingImport.summary.added} 道新题。文件中的题目内容只保存在本机；云端已有题目的复盘进度会继续同步。`);
    setPendingImport(null);
  };
  const syncNow = async () => {
    if (actionBusy || !local.ready) return; setActionBusy(true); setCloudError("");
    try {
      await syncFenbiNow(session.token, lifetime.current.signal);
      if (!valid()) return;
      if (accountRef.current) applyAccount({ ...accountRef.current, syncState: "queued" });
      setNotice("已安排更新粉笔练习与错题，完成后会自动显示。已有复盘可以继续使用。");
      await pollAccount();
    } catch (failure) { handleError(failure); }
    finally { if (valid()) setActionBusy(false); }
  };
  const disconnect = async () => {
    if (actionBusy) return; setActionBusy(true);
    try {
      await disconnectFenbi(session.token, lifetime.current.signal);
      if (!valid()) return;
      if (accountRef.current) applyAccount({ ...accountRef.current, syncState: "paused", nextSync: null });
      setNotice("已停止自动读取粉笔错题。已有错题、笔记和复习进度保留，需要恢复时重新扫码连接。"); setCloudError("");
    } catch (failure) { handleError(failure); }
    finally { if (valid()) setActionBusy(false); }
  };
  const verifyDevice = async () => {
    if (actionBusy || deviceAttemptedRef.current || !navigator.onLine || !accountRef.current?.error?.includes("设备验证")) return;
    deviceAttemptedRef.current = true; setDeviceAttempted(true);
    if (!markFenbiDeviceAttempt(session.token)) {
      setDeviceMessage("本次设备登记状态无法保存，已停止尝试。请在粉笔官方页面或 App 完成设备验证。"); return;
    }
    setActionBusy(true); setDeviceMessage("");
    try {
      const extras = collectFenbiBrowserExtras();
      const verified = await verifyFenbiDevice(session.token, FENBI_STARTUP_ID, extras, lifetime.current.signal);
      if (!valid()) return;
      applyAccount(verified); setCloudError("");
      setNotice("设备登记已提交，正在继续更新错题。");
      await pollAccount();
    } catch (failure) {
      if (!valid()) return;
      setDeviceMessage("这次设备登记未完成，已停止尝试。请在粉笔官方页面或 App 完成设备验证；不会自动重试或更换设备信息。");
      if (failure instanceof MistakeApiError && failure.status === 401) callbacks.current.onExpired();
    } finally { if (valid()) setActionBusy(false); }
  };
  const needsDeviceVerification = Boolean(account?.error?.includes("设备验证"));
  const syncing = account?.syncState === "queued" || account?.syncState === "syncing";
  const needsLogin = !needsDeviceVerification && (account?.syncState === "reauth" || account?.syncState === "paused");
  const statusText = !online ? "当前离线，可继续复盘"
    : needsDeviceVerification ? "粉笔要求完成设备验证"
    : account?.syncState === "syncing" ? `正在更新${account.syncStage==="history"?`练习 · 已读取 ${account.historyCount||0} 次`:"错题"}${account.total ? ` · ${account.loaded} / ${account.total}` : ""}`
    : account?.syncState === "queued" ? "已安排同步，正在等待更新"
    : account?.syncState === "reauth" ? "粉笔登录需要重新确认"
    : account?.syncState === "paused" ? "已停止自动更新错题"
    : account?.syncState === "error" ? "上次更新未完成，可重试"
    : account?.historyUpdatedAt ? `练习更新于 ${localTime(account.historyUpdatedAt)}` : account?.lastSync ? `错题更新于 ${localTime(account.lastSync)}` : loading ? "正在读取云端错题…" : "正在准备你的错题本";
  const connection = <div className="stack">
    {mode==="settings" ? <section className="panel mistake-account-panel">
      <div className="mistake-account-identity">{online ? <Cloud /> : <CloudOff />}<div><small>粉笔账号 · 自动同步</small><strong>{account?.displayName || "我的粉笔账号"}</strong><span role="status">{statusText}</span>{account?.nextSync && account.syncState === "idle" && <small>下次自动更新 {localTime(account.nextSync)}</small>}</div></div>
      <div className="mistake-account-actions">
        {needsDeviceVerification ? <button type="button" className="soft-btn" disabled={!online || actionBusy || deviceAttempted} onClick={verifyDevice}>{actionBusy ? "正在登记设备…" : deviceAttempted ? "请完成官方验证" : "完成设备验证"}</button> : needsLogin ? <button type="button" className="soft-btn" onClick={() => callbacks.current.onReconnect()}>重新扫码连接</button> : <button type="button" className="soft-btn" disabled={!local.ready || !online || syncing || actionBusy} onClick={syncNow}><RefreshCw className={syncing ? "mistake-sync-spinning" : ""} />{syncing ? "正在同步" : "立即检查更新"}</button>}
        <details className="mistake-account-more"><summary>更多</summary><div><button type="button" disabled={actionBusy || !online || account?.syncState === "paused"} onClick={disconnect}>停止自动同步</button><button type="button" disabled={logoutBusy} onClick={() => callbacks.current.onLogout()}>{logoutBusy?"正在退出…":"退出此账号"}</button><small>退出会撤销两站共享连接；已有学习记录保留。</small></div></details>
      </div>
      <div className="mistake-progress-status">已保存 {account?.historyCount||0} 次练习 · {account?.questionCount||0} 道错题。打开网站自动检查更新，云端每 6 小时继续同步。{account?.historyExcluded ? `另有 ${account.historyExcluded} 次练习报告不完整，暂未计入统计。` : ""}</div><div className="mistake-progress-status" role="status">{sending ? "正在保存复盘进度到云端…" : pendingCount ? `${pendingCount} 道题的复盘进度待同步${!online ? "，联网后继续" : ""}` : "复盘先保存在本机，再同步到当前账号"}</div>
    </section> : <div className="notice-banner"><span>{account?.displayName||"我的粉笔账号"} · {statusText}</span><button className="soft-btn" onClick={onSettings}>管理账号</button></div>}
    {mode==="settings" && needsDeviceVerification && <div className="mistake-cloud-notice" role="status"><span>{account?.error}<br />使用当前浏览器完成粉笔要求的设备登记，不读取密码。{deviceMessage || (deviceAttempted ? "本次会话已尝试登记，请到粉笔官方页面或 App 完成验证。" : "仅在你点击后登记一次；未完成时停止尝试。")}</span><a href="https://www.fenbi.com/" target="_blank" rel="noopener noreferrer">打开粉笔官网</a></div>}
    {!online && <div className="mistake-cloud-notice">当前处于离线状态，已保存在本机的题目和笔记可以继续使用。</div>}
    {cloudError && <div className="mistake-storage-warning" role="alert"><span>{cloudError}</span><button type="button" className="soft-btn" disabled={!online || loading} onClick={() => void pull(true)}>重新连接</button></div>}
    <StorageWarning message={local.storageError} notebook={local.notebook} onRetry={!local.ready ? local.retryRead : undefined} />
    {notice && <div className="mistake-cloud-notice" role="status">{notice}<button type="button" className="mistake-text-button" onClick={() => setNotice("")}>收起</button></div>}
    {pendingImport && <section className="panel mistake-import-confirm" aria-label="确认导入到当前账号"><h3>导入到「{account?.displayName || "当前账号"}」的本机错题本？</h3><p>这份文件会新增 {pendingImport.summary.added} 题、更新 {pendingImport.summary.updated} 题。请确认它属于你有权使用的题目。文件中的题目内容只保存在本机，云端已有题目的复盘进度会合并同步。</p><div className="button-row"><button type="button" className="primary-btn" onClick={confirmImport}>确认导入到此账号</button><button type="button" className="soft-btn" onClick={() => setPendingImport(null)}>取消</button></div></section>}
  </div>;
  if(mode==="background")return null;
  if(mode==="settings")return portal(connection);
  if (!local.ready) return portal(<div className="stack">{connection}<div className="panel mistake-cloud-loading" role="status">{local.storageError ? "读取恢复后即可继续同步，原本机记录保持不变。" : "正在读取此账号的本机错题…"}</div></div>);
  return portal(<MistakesView notebook={local.notebook} onChange={changeNotebook} onImport={importFile} onExport={() => downloadNotebook(local.notebookRef.current)} connectionSlot={connection} />);
}
