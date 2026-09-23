import { isFenbiSession, MistakeApiError } from "./mistakeApi";
import type { FenbiAccount, FenbiLoginChallenge, FenbiLoginStatus, FenbiSession } from "./mistakeApi";

type SharedSession = { token: string; account: FenbiAccount };

async function request<T>(path: "start" | "poll" | "session" | "logout", body?: object, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(`/api/sso?path=${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    if (response.status === 401) throw new MistakeApiError("共享登录已失效，请重新扫码。", 401);
    if (!response.ok) throw new MistakeApiError(response.status >= 500
      ? "两科目连接暂时不可用，请稍后重试。"
      : "两科目连接未能完成，请重试。", response.status);
    return await response.json() as T;
  } catch (error) {
    if (error instanceof MistakeApiError || signal?.aborted) throw error;
    throw new MistakeApiError(navigator.onLine ? "两科目连接暂时不可用，请稍后重试。" : "当前离线，联网后可继续连接粉笔账号。");
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
  }
}

function sessionFrom(value: SharedSession): FenbiSession {
  const result = { token: value?.token, accountId: value?.account?.accountId };
  if (!isFenbiSession(result)) throw new MistakeApiError("共享账号信息不完整，请重试。");
  return result;
}

export async function getSharedFenbiSession(signal?: AbortSignal): Promise<{ session: FenbiSession; account: FenbiAccount } | null> {
  try {
    const result = await request<SharedSession>("session", undefined, signal);
    return { session: sessionFrom(result), account: result.account };
  } catch (error) {
    if (error instanceof MistakeApiError && error.status === 401) return null;
    throw error;
  }
}

export const startSharedFenbiLogin = (signal?: AbortSignal) => request<FenbiLoginChallenge>("start", {}, signal);
export const pollSharedFenbiLogin = (challenge: string, signal?: AbortSignal) => request<FenbiLoginStatus>("poll", { challenge }, signal);
export const logoutSharedFenbi = (signal?: AbortSignal) => request<{ ok: true }>("logout", {}, signal);
