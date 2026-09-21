/** Fenbi's publicly observable first-party web protocol. Never logs bodies or session values. */
export type CookieJar = Array<{ name: string; value: string; domain: string; path: string; expires?: number }>;
export type ProviderErrorCode = "AUTH_REQUIRED" | "VERIFICATION_REQUIRED" | "RATE_LIMITED" | "NETWORK" | "PROVIDER_UNAVAILABLE" | "INVALID_RESPONSE" | "INVALID_REQUEST";
export class ProviderError extends Error {
  code: ProviderErrorCode;
  httpStatus?: number;
  constructor(code: ProviderErrorCode, message: string, httpStatus?:number) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export type FenbiTreeNode = {
  id?: number | string;
  name?: string;
  questionIds?: Array<number | string> | null;
  children?: FenbiTreeNode[] | null;
  [key: string]: unknown;
};
type JsonObject = Record<string, unknown>;
export type FenbiQuestionBatch = {
  requestedIds: string[];
  solutions: JsonObject[];
  materials: JsonObject[];
  q2subQuestionIds: unknown;
};
export type DeviceRegistration = {
  startupId: string;
  extras: { canvas: string; webgl: string; screen: string; language: string; platform: string; cores: string; memory: string; touchPoints: string };
};

const QR_ORIGIN = "https://ke.fenbi.com";
const LOGIN_ORIGIN = "https://login.fenbi.com";
const TIKU_ORIGIN = "https://tiku.fenbi.com";
const MAX_JSON_BYTES = 16 * 1024 * 1024;
const AUTH_HOSTS = new Set(["ke.fenbi.com", "login.fenbi.com", "tiku.fenbi.com"]);
const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const object = (value: unknown): value is JsonObject => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const invalidResponse = () => new ProviderError("INVALID_RESPONSE", "粉笔接口返回结构变化，请稍后重试。");

function inFenbiDomain(domain: string) {
  const host = domain.replace(/^\./, "");
  return /^[a-z0-9.-]+$/.test(host) && (host === "fenbi.com" || host.endsWith(".fenbi.com"));
}

// A leading dot preserves Domain-cookie semantics; no dot means host-only.
function domainMatches(host: string, domain: string) {
  return domain.startsWith(".") ? host === domain.slice(1) || host.endsWith(domain) : host === domain;
}

function validCookie(cookie: CookieJar[number]) {
  return Boolean(cookie && typeof cookie.name === "string" && COOKIE_NAME.test(cookie.name)
    && typeof cookie.value === "string" && !/[\u0000-\u0020;\u007f]/.test(cookie.value)
    && cookie.name.length + cookie.value.length <= 8192
    && typeof cookie.domain === "string" && inFenbiDomain(cookie.domain)
    && typeof cookie.path === "string" && cookie.path.startsWith("/") && !/[\r\n]/.test(cookie.path)
    && (cookie.expires === undefined || Number.isFinite(cookie.expires)));
}

function cookiesFor(jar: CookieJar, url: URL) {
  const now = Date.now();
  return jar.filter(cookie => validCookie(cookie) && (cookie.expires === undefined || cookie.expires > now)
    && domainMatches(url.hostname, cookie.domain)
    && (url.pathname === cookie.path || (url.pathname.startsWith(cookie.path) && (cookie.path.endsWith("/") || url.pathname[cookie.path.length] === "/"))))
    .sort((a, b) => b.path.length - a.path.length)
    .map(cookie => `${cookie.name}=${cookie.value}`).join("; ");
}

function setCookieHeaders(headers: Headers): string[] {
  const extended = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof extended.getSetCookie === "function") return extended.getSetCookie();
  return (headers.get("set-cookie") || "").split(/,(?=\s*[!#$%&'*+\-.^_`|~0-9A-Za-z]+=)/).filter(Boolean);
}

function receiveCookies(jar: CookieJar, headers: Headers, url: URL) {
  const now = Date.now();
  const live = jar.filter(cookie => validCookie(cookie) && (cookie.expires === undefined || cookie.expires > now));
  jar.splice(0, jar.length, ...live);
  for (const header of setCookieHeaders(headers)) {
    const [pair, ...attributes] = header.split(";");
    const equals = pair.indexOf("=");
    if (equals < 1) continue;
    const parsed = new Map(attributes.map(part => {
      const index = part.indexOf("=");
      return index < 0 ? [part.trim().toLowerCase(), ""] : [part.slice(0, index).trim().toLowerCase(), part.slice(index + 1).trim()];
    }));
    const defaultPath = url.pathname.slice(0, url.pathname.lastIndexOf("/")) || "/";
    let domain = url.hostname;
    if (parsed.has("domain")) {
      const declared = (parsed.get("domain") || "").toLowerCase().replace(/^\./, "");
      if (!declared || !inFenbiDomain(declared) || (url.hostname !== declared && !url.hostname.endsWith(`.${declared}`))) continue;
      domain = `.${declared}`;
    }
    const path = parsed.get("path");
    const cookie: CookieJar[number] = { name: pair.slice(0, equals).trim(), value: pair.slice(equals + 1).trim(), domain, path: path?.startsWith("/") ? path : defaultPath };
    const maxAge = parsed.get("max-age");
    if (maxAge !== undefined && /^-?\d+$/.test(maxAge)) cookie.expires = now + Number(maxAge) * 1000;
    else if (parsed.has("expires")) {
      const expires = Date.parse(parsed.get("expires") || "");
      if (Number.isFinite(expires)) cookie.expires = expires;
    }
    if (!validCookie(cookie)) continue;
    const old = jar.findIndex(item => item.name === cookie.name && item.domain === cookie.domain && item.path === cookie.path);
    if (old >= 0) jar.splice(old, 1);
    if (cookie.expires === undefined || cookie.expires > now) jar.push(cookie);
  }
  if (jar.length > 100) throw invalidResponse();
}

function responseStatus(status: number): void {
  if (status === 401 || status === 403) throw new ProviderError("AUTH_REQUIRED", "粉笔登录已失效，请重新扫码连接。",status);
  if ([430, 432, 453].includes(status)) throw new ProviderError("VERIFICATION_REQUIRED", "粉笔要求在官方页面完成安全验证，请完成后重新连接。",status);
  if (status === 429) throw new ProviderError("RATE_LIMITED", "粉笔暂时限制读取频率，请稍后再同步。",status);
  if (status < 200 || status >= 300) throw new ProviderError("PROVIDER_UNAVAILABLE", "粉笔服务暂时无法读取，请稍后重试。",status);
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.headers.get("content-type")?.toLowerCase().includes("json")) throw invalidResponse();
  if (Number(response.headers.get("content-length") || 0) > MAX_JSON_BYTES) throw invalidResponse();
  if (!response.body) throw invalidResponse();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_JSON_BYTES) {
        await reader.cancel();
        throw invalidResponse();
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw invalidResponse();
  } finally {
    reader.releaseLock();
  }
}

async function request(url: URL, cookies: CookieJar, body?: JsonObject, cdn = false): Promise<unknown> {
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")
    || (!cdn && !AUTH_HOSTS.has(url.hostname)) || (cdn && !(url.hostname === "fbstatic.cn" || url.hostname.endsWith(".fbstatic.cn")))) {
    throw new ProviderError("INVALID_REQUEST", "请求地址不在粉笔只读接口范围内。");
  }
  const headers: Record<string, string> = { Accept: "application/json" };
  if (!cdn) {
    headers.Origin = "https://www.fenbi.com";
    headers.Referer = "https://www.fenbi.com/spa/tiku/";
    const cookie = cookiesFor(cookies, url);
    if (cookie) headers.Cookie = cookie;
  }
  if (body) headers["Content-Type"] = "application/json";
  let response: Response;
  try {
    response = await fetch(url, {
      method: body ? "POST" : "GET", redirect: "error", credentials: "omit", headers,
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000)
    });
  } catch {
    throw new ProviderError("NETWORK", "连接粉笔超时或网络不可用，请稍后重试。");
  }
  if (!cdn) receiveCookies(cookies, response.headers, url);
  responseStatus(response.status);
  const value = await readJson(response);
  // Some first-party APIs express the same login/verification failure in JSON.
  if (object(value) && typeof value.code === "number" && [401, 403, 429, 430, 432, 453].includes(value.code)) responseStatus(value.code);
  return value;
}

function validDeviceId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 2048 && !/[\s\u0000-\u001f\u007f]/.test(value);
}

function tikuUrl(path: string, params: Record<string, string>, deviceId?: string) {
  const url = new URL(path, TIKU_ORIGIN);
  for (const [key, value] of Object.entries({ app: "web", kav: "131", av: "134", hav: "128", version: "3.0.0.0", gav: "2", apcId: "0", ...params })) url.searchParams.set(key, value);
  if (deviceId !== undefined && deviceId !== "") {
    if (!validDeviceId(deviceId)) throw new ProviderError("INVALID_REQUEST", "设备登记信息无效，请重新连接。");
    url.searchParams.set("deviceId", deviceId);
  }
  return url;
}

function requestedIds(ids: Array<string | number>): string[] {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 10) throw new ProviderError("INVALID_REQUEST", "每批只能读取 1 至 10 道本人错题。");
  const normalized = ids.map(String);
  if (normalized.some(id => !/^\d{1,20}$/.test(id)) || new Set(normalized).size !== normalized.length) throw new ProviderError("INVALID_REQUEST", "题号列表格式不正确。");
  return normalized;
}

export async function startQr(): Promise<{ lgtoken: string; codeContent: string; cookies: CookieJar }> {
  const cookies: CookieJar = [];
  const url = new URL("/qrcode-login/api/gen_code", QR_ORIGIN);
  url.searchParams.set("random", String(Math.random()));
  const result = await request(url, cookies);
  if (!object(result) || result.code !== 1 || !object(result.data)
    || typeof result.data.lgtoken !== "string" || !result.data.lgtoken || result.data.lgtoken.length > 2048
    || typeof result.data.codeContent !== "string" || !result.data.codeContent || result.data.codeContent.length > 4096) throw invalidResponse();
  return { lgtoken: result.data.lgtoken, codeContent: result.data.codeContent, cookies };
}

export async function pollQr(lgtoken: string, cookies: CookieJar): Promise<{ status: number; cookies: CookieJar }> {
  if (typeof lgtoken !== "string" || !lgtoken || lgtoken.length > 2048) throw new ProviderError("INVALID_REQUEST", "扫码请求已失效，请重新生成二维码。");
  const result = await request(new URL("/qrcode-login/api/query_code_status", QR_ORIGIN), cookies, { lgtoken });
  if (!object(result) || result.code !== 1 || typeof result.data !== "number" || !Number.isInteger(result.data) || result.data < 0 || result.data > 6) throw invalidResponse();
  return { status: result.data, cookies };
}

export async function getIdentity(cookies: CookieJar): Promise<{ providerId: string; displayName: string }> {
  const result = await request(new URL("/api/users/info", LOGIN_ORIGIN), cookies);
  // The official question-bank app consumes userId and identity directly from /info.
  if (!object(result) || !["number", "string"].includes(typeof result.userId)
    || (typeof result.userId === "number" && !Number.isSafeInteger(result.userId))
    || !/^[1-9]\d{0,19}$/.test(String(result.userId))
    || typeof result.identity !== "string" || !result.identity.trim()) throw invalidResponse();
  return { providerId: String(result.userId), displayName: result.identity.trim().slice(0, 120) };
}

/** Forward the real browser's official collector output once; never synthesize device properties server-side. */
export async function registerDevice(cookies: CookieJar, input: DeviceRegistration): Promise<string> {
  if (!object(input) || typeof input.startupId !== "string" || !input.startupId.trim() || input.startupId.length > 2048 || /[\u0000-\u001f\u007f]/.test(input.startupId) || !object(input.extras)) {
    throw new ProviderError("INVALID_REQUEST", "请在当前浏览器重新完成设备登记。");
  }
  const fields = ["canvas", "webgl", "screen", "language", "platform", "cores", "memory", "touchPoints"] as const;
  const extras: Record<string, string> = {};
  for (const field of fields) {
    const value = input.extras[field];
    if (typeof value !== "string" || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) throw new ProviderError("INVALID_REQUEST", "设备登记信息不完整，请在当前浏览器重试。");
    extras[field] = value;
  }
  const result = await request(new URL("/api/users/device/sid/create", LOGIN_ORIGIN), cookies, { pf: "web", startupId: input.startupId, extras });
  if (!object(result) || result.code !== 1 || !object(result.data) || !validDeviceId(result.data.deviceId)) throw invalidResponse();
  return result.data.deviceId;
}

export async function readTree(cookies: CookieJar, deviceId?: string): Promise<FenbiTreeNode[]> {
  const result = await request(tikuUrl("/api/xingce/errors/keypoint-tree", { timeRange: "0", order: "desc" }, deviceId), cookies);
  if (!Array.isArray(result) || result.some(node => !object(node))) throw invalidResponse();
  return result as FenbiTreeNode[];
}

export async function readQuestionBatch(cookies: CookieJar, ids: Array<string | number>, deviceId?: string): Promise<FenbiQuestionBatch> {
  const normalized = requestedIds(ids);
  let result = await request(tikuUrl("/api/xingce/universal/auth/solutions", { type: "1", questionIds: normalized.join(",") }, deviceId), cookies);
  if (object(result) && Array.isArray(result.cdnUrls) && result.cdnUrls.length) {
    let found: unknown = null;
    for (const candidate of result.cdnUrls.slice(0, 2)) {
      if (typeof candidate !== "string") continue;
      let url: URL;
      try { url = new URL(candidate.startsWith("//") ? `https:${candidate}` : candidate); } catch { continue; }
      if (url.protocol !== "https:" || !(url.hostname === "fbstatic.cn" || url.hostname.endsWith(".fbstatic.cn")) || url.username || url.password || (url.port && url.port !== "443")) continue;
      // CDN receives no account cookies, authorization, origin, or referer.
      try { found = await request(url, [], undefined, true); break; } catch (error) {
        if (error instanceof ProviderError && ["AUTH_REQUIRED", "VERIFICATION_REQUIRED", "RATE_LIMITED"].includes(error.code)) throw error;
      }
    }
    if (!found) throw new ProviderError("PROVIDER_UNAVAILABLE", "粉笔题目附件暂时无法读取。");
    result = found;
  }
  if (!object(result) || !Array.isArray(result.solutions)
    || result.solutions.some(question => !object(question) || !normalized.includes(String(question.id)))
    || (result.materials != null && (!Array.isArray(result.materials) || result.materials.some(material => !object(material))))) throw invalidResponse();
  return { requestedIds: normalized, solutions: result.solutions as JsonObject[], materials: (result.materials || []) as JsonObject[], q2subQuestionIds: result.q2subQuestionIds ?? null };
}

export async function readAnswers(cookies: CookieJar, ids: Array<string | number>, deviceId?: string): Promise<JsonObject[]> {
  const normalized = requestedIds(ids);
  const result = await request(tikuUrl("/api/xingce/user-answers", { ids: normalized.join(",") }, deviceId), cookies);
  if (!Array.isArray(result) || result.some(answer => !object(answer) || !normalized.includes(String(answer.questionId)) || !object(answer.answer))) throw invalidResponse();
  return result as JsonObject[];
}
