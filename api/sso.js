/** XC's same-origin relay for the shared Fenbi session. Never send the GZ token to page JavaScript. */
const UPSTREAM = "https://atwsraivphybkfmyeubd.supabase.co/functions/v1/gz-fenbi";
const COOKIE = "__Secure-pithiest-fenbi";
const TOKEN = /^[a-f0-9]{64}$/i;
const CHALLENGE = /^[a-f0-9]{64}$/i;
const MAX_BODY = 4096;
const COOKIE_AGE = 30 * 24 * 60 * 60;

const baseHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  Vary: "Origin, Cookie",
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...baseHeaders, ...headers } });
}
function cookieHeader(token) {
  return `${COOKIE}=${token}; Path=/; Domain=.pithiest.cn; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_AGE}`;
}
function clearCookie() {
  return `${COOKIE}=; Path=/; Domain=.pithiest.cn; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
function readCookie(request) {
  const raw = request.headers.get("cookie") || "";
  if (raw.length > 8192) return null;
  const matches = raw.split(";").map(part => part.trim()).filter(part => part.startsWith(`${COOKIE}=`));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(COOKIE.length + 1);
  return TOKEN.test(token) ? token : null;
}
function vercelClientIp(request) {
  const raw = request.headers.get("x-vercel-forwarded-for");
  if (!raw || raw.length > 45 || /[,\s%]/.test(raw)) return null;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(raw))
    return raw.split(".").every(part => Number(part) <= 255) ? raw : null;
  if (!raw.includes(":")) return null;
  try {
    const hostname = new URL(`http://[${raw}]/`).hostname;
    return hostname.startsWith("[") && hostname.endsWith("]") ? raw : null;
  } catch { return null; }
}
async function readBody(request) {
  const type = request.headers.get("content-type") || "";
  if (!/^application\/json(?:\s*;|$)/i.test(type)) return null;
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) { await reader.cancel().catch(() => {}); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const value = JSON.parse(new TextDecoder().decode(bytes));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch { return null; }
}
async function callUpstream(path, options, fetchImpl, signal) {
  const response = await fetchImpl(`${UPSTREAM}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.clientIp ? { "X-Forwarded-For": options.clientIp } : {}),
    },
    body: JSON.stringify(options.body || {}),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
  });
  if (response.status === 401) return { status: 401, data: null };
  if (!response.ok || Number(response.headers.get("content-length") || 0) > 100_000) return { status: 503, data: null };
  try {
    const text = await response.text();
    return text.length <= 100_000 ? { status: 200, data: JSON.parse(text) } : { status: 503, data: null };
  } catch { return { status: 503, data: null }; }
}
function validBridge(data) {
  return data && TOKEN.test(data.gz?.token || "") && TOKEN.test(data.xc?.token || "")
    && typeof data.xc?.account?.accountId === "string"
    && data.xc.account.accountId.length > 0 && data.xc.account.accountId.length < 200;
}
async function bridge(token, fetchImpl, signal) {
  const result = await callUpstream("/sso/bridge", { token, body: {} }, fetchImpl, signal);
  return result.status === 200 && validBridge(result.data) ? { status: 200, data: result.data } : { status: result.status === 401 ? 401 : 503, data: null };
}

export async function handleSsoRequest(request, fetchImpl = fetch) {
  try {
    const url = new URL(request.url);
    const origins = url.searchParams.getAll("path");
    if (origins.length !== 1 || [...url.searchParams.keys()].some(key => key !== "path")) return json({ error: "入口不存在。" }, 404);
    const path = origins[0];
    const method = path === "session" ? "GET" : "POST";
    if (!["start", "poll", "session", "logout"].includes(path) || request.method !== method) return json({ error: "入口不存在。" }, 404);
    const origin = request.headers.get("origin");
    const fetchSite = request.headers.get("sec-fetch-site");
    if ((origin && origin !== url.origin) || (request.method === "POST" && !origin) || (fetchSite && !["same-origin", "none"].includes(fetchSite)))
      return json({ error: "访问来源不允许。" }, 403);

    if (path === "session") {
      const token = readCookie(request);
      if (!token) return json({ error: "尚未连接粉笔账号。" }, 401);
      const result = await bridge(token, fetchImpl, request.signal);
      if (result.status === 401) return json({ error: "共享登录已失效。" }, 401, { "Set-Cookie": clearCookie() });
      if (!result.data) return json({ error: "共享登录暂时不可用，请稍后重试。" }, 503);
      return json({ token: result.data.xc.token, account: result.data.xc.account }, 200, { "Set-Cookie": cookieHeader(result.data.gz.token) });
    }

    const body = await readBody(request);
    if (!body) return json({ error: "请求格式不正确。" }, 400);
    if (path === "start" && Object.keys(body).length === 0) {
      const result = await callUpstream("/login/start", { body, clientIp: vercelClientIp(request) }, fetchImpl, request.signal);
      const challenge = result.data;
      if (result.status !== 200 || !CHALLENGE.test(challenge?.challenge || "") || typeof challenge.codeContent !== "string" || challenge.codeContent.length > 20_000)
        return json({ error: "暂时无法生成登录二维码。" }, 503);
      return json({ challenge: challenge.challenge, codeContent: challenge.codeContent, expiresAt: challenge.expiresAt });
    }
    if (path === "poll" && Object.keys(body).length === 1 && CHALLENGE.test(body.challenge || "")) {
      const result = await callUpstream("/login/poll", { body }, fetchImpl, request.signal);
      if (result.status !== 200 || !Number.isInteger(result.data?.status)) return json({ error: "登录状态暂时不可用。" }, result.status === 401 ? 401 : 503);
      if (result.data.status !== 3) return json({ status: result.data.status });
      if (!TOKEN.test(result.data.token || "")) return json({ error: "登录状态不完整，请重新扫码。" }, 502);
      const linked = await bridge(result.data.token, fetchImpl, request.signal);
      if (!linked.data) return json({ error: "两科目连接暂未完成，请重新扫码。" }, 503);
      return json({ status: 3, token: linked.data.xc.token, account: linked.data.xc.account }, 200, { "Set-Cookie": cookieHeader(linked.data.gz.token) });
    }
    if (path === "logout" && Object.keys(body).length === 0) {
      const token = readCookie(request);
      if (!token) return json({ ok: true }, 200, { "Set-Cookie": clearCookie() });
      const result = await callUpstream("/logout", { token }, fetchImpl, request.signal);
      if (result.status === 200 || result.status === 401) return json({ ok: true }, 200, { "Set-Cookie": clearCookie() });
      return json({ error: "云端注销暂未完成，请重试。" }, 503);
    }
    return json({ error: "请求格式不正确。" }, 400);
  } catch {
    return json({ error: "共享登录暂时不可用，请稍后重试。" }, 503);
  }
}

// The runtime may pass a context object as fetch's second argument. Keep the
// test-only fetch injection on handleSsoRequest out of the production entrypoint.
export default { fetch(request) { return handleSsoRequest(request); } };
