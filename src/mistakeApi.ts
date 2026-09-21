import type { MistakeNotebook, MistakeQuestion } from "./mistakes";
import type { FenbiBrowserExtras } from "./fenbiDevice";

const CLOUD_URL = "https://atwsraivphybkfmyeubd.supabase.co/functions/v1/fenbi-cloud";
export const FENBI_SESSION_KEY = "pithiest-xingce-fenbi-session-v1";
export type FenbiAccount = {
  accountId: string;
  displayName: string;
  lastSync: string | null;
  lastAttempt: string | null;
  nextSync: string | null;
  syncState: "idle" | "queued" | "syncing" | "error" | "reauth" | "paused";
  error: string | null;
  questionCount: number;
  loaded: number;
  total: number;
  progressRevision?: number;
  sourceStamp?: string | null;
};
export type FenbiSession = { token: string; accountId: string };
export type FenbiLoginChallenge = { challenge: string; codeContent: string; expiresAt: string | number };
export type FenbiLoginStatus = { status: 0 | 1 | 2 | 3 | 4 | 5 | 6; token?: string; account?: FenbiAccount };
export type FenbiProgress = { id: string; progress: MistakeQuestion["progress"] };
export type FenbiProgressResult = { progress: FenbiProgress[]; revision: string | number };

export class MistakeApiError extends Error {
  status: number;
  constructor(message: string, status = 0) { super(message); this.name = "MistakeApiError"; this.status = status; }
}

export function isFenbiSession(value: unknown): value is FenbiSession {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<FenbiSession>;
  return typeof candidate.token === "string" && /^[a-f0-9]{64}$/i.test(candidate.token)
    && typeof candidate.accountId === "string" && candidate.accountId.length > 0 && candidate.accountId.length < 200;
}

export function readFenbiSession(): FenbiSession | null {
  try {
    const raw = JSON.parse(localStorage.getItem(FENBI_SESSION_KEY) || "null") as unknown;
    return isFenbiSession(raw) ? { token: raw.token, accountId: raw.accountId } : null;
  } catch { return null; }
}

export function storeFenbiSession(session: FenbiSession | null): boolean {
  try {
    if (session) localStorage.setItem(FENBI_SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(FENBI_SESSION_KEY);
    return true;
  } catch { return false; }
}

export function mistakeErrorMessage(error: unknown): string {
  if (error instanceof MistakeApiError) return error.message;
  if (typeof navigator !== "undefined" && !navigator.onLine) return "当前没有网络，已保存的错题和笔记仍可使用，联网后会继续同步。";
  return "暂时无法连接同步服务，请稍后重试。已有错题和复盘记录会保留。";
}

async function request<T>(path: string, options: { token?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(`${CLOUD_URL}${path}`, {
      method: options.body === undefined ? "GET" : "POST",
      headers: {
        Accept: "application/json",
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: controller.signal,
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) {
      const message = response.status === 401 ? "登录已失效，请重新用粉笔 App 扫码登录。"
         : response.status === 409 && path === "/verify-device" ? "此次设备登记未完成，已停止尝试。请在粉笔官方页面或 App 完成设备验证。"
        : response.status === 429 ? "请求较频繁，请稍等片刻再试。"
        : response.status === 413 ? "这次同步内容过大，请先导出备份，再重试。"
        : response.status >= 500 ? "云端同步暂时不可用，请稍后重试。已有记录会保留。"
        : "本次操作未能完成，请重试；已有错题和复盘记录会保留。";
      throw new MistakeApiError(message, response.status);
    }
    if (response.status === 204) return {} as T;
    return await response.json() as T;
  } catch (error) {
    if (options.signal?.aborted || error instanceof MistakeApiError) throw error;
    throw new MistakeApiError(mistakeErrorMessage(error));
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", cancel);
  }
}

export const fenbiHealth = (signal?: AbortSignal) => request<Record<string, unknown>>("/health", { signal });
export const startFenbiLogin = (signal?: AbortSignal) => request<FenbiLoginChallenge>("/login/start", { body: {}, signal });
export const pollFenbiLogin = (challenge: string, signal?: AbortSignal) => request<FenbiLoginStatus>("/login/poll", { body: { challenge }, signal });
export const getFenbiAccount = (token: string, signal?: AbortSignal) => request<FenbiAccount>("/account", { token, signal });
export const getFenbiNotebook = (token: string, signal?: AbortSignal) => request<{ notebook: MistakeNotebook; account: FenbiAccount }>("/notebook", { token, signal });
export const getFenbiProgress = (token: string, signal?: AbortSignal) => request<FenbiProgressResult>("/progress", { token, signal });
export const saveFenbiProgress = (token: string, progress: FenbiProgress[], signal?: AbortSignal) => request<FenbiProgressResult>("/progress", { token, body: { progress }, signal });
export const syncFenbiNow = (token: string, signal?: AbortSignal) => request<Record<string, unknown>>("/sync", { token, body: {}, signal });
export const logoutFenbi = (token: string, signal?: AbortSignal) => request<Record<string, unknown>>("/logout", { token, body: {}, signal });
export const disconnectFenbi = (token: string, signal?: AbortSignal) => request<Record<string, unknown>>("/disconnect", { token, body: {}, signal });

export async function verifyFenbiDevice(token: string, startupId: string, extras: FenbiBrowserExtras, signal?: AbortSignal): Promise<FenbiAccount> {
  const result = await request<FenbiAccount | { account: FenbiAccount }>("/verify-device", { token, body: { startupId, extras }, signal });
  return "account" in result ? result.account : result;
}
