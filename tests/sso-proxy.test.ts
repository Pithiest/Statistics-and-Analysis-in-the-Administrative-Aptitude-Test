import assert from "node:assert/strict";
import test from "node:test";
import { handleSsoRequest } from "../api/sso.js";

const gzToken = "a".repeat(64);
const xcToken = "b".repeat(64);
const challenge = "c".repeat(64);
const bridge = { gz: { token: gzToken, account: { accountId: "gz-account" }, studyCode: "synthetic" }, xc: { token: xcToken, account: { accountId: "xc-account", displayName: "合成同学" } } };
const url = (path: string) => `https://xc.pithiest.cn/api/sso?path=${path}`;
const request = (path: string, body?: object, cookie?: string, origin = "https://xc.pithiest.cn") => new Request(url(path), {
  method: body === undefined ? "GET" : "POST",
  headers: { Origin: origin, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

test("shared QR flow returns only the XC session and stores the GZ token in an HttpOnly cookie", async () => {
  const called: Array<{ path: string; auth: string | null; body: unknown }> = [];
  const fetcher = async (target: string, options: RequestInit) => {
    const path = new URL(target).pathname;
    called.push({ path, auth: new Headers(options.headers).get("Authorization"), body: JSON.parse(String(options.body)) });
    if (path.endsWith("/login/start")) return reply({ challenge, codeContent: "synthetic-qr", expiresAt: "2026-09-23T10:00:00Z" });
    if (path.endsWith("/login/poll")) return reply({ status: 3, token: gzToken, account: { accountId: "gz-account" } });
    if (path.endsWith("/sso/bridge")) return reply(bridge);
    throw Error(`Unexpected ${path}`);
  };
  const start = await handleSsoRequest(request("start", {}), fetcher);
  assert.equal(start.status, 200);
  assert.deepEqual(await start.json(), { challenge, codeContent: "synthetic-qr", expiresAt: "2026-09-23T10:00:00Z" });
  const poll = await handleSsoRequest(request("poll", { challenge }), fetcher);
  assert.equal(poll.status, 200);
  const body = await poll.text();
  assert.deepEqual(JSON.parse(body), { status: 3, token: xcToken, account: bridge.xc.account });
  assert.ok(!body.includes(gzToken));
  assert.match(poll.headers.get("Set-Cookie") || "", /HttpOnly; Secure; SameSite=Lax/);
  assert.ok((poll.headers.get("Set-Cookie") || "").includes(gzToken));
  assert.equal(poll.headers.get("Cache-Control"), "no-store");
  assert.equal(called.length, 3);
  assert.equal(called[2].auth, `Bearer ${gzToken}`);
  assert.deepEqual(called[2].body, {});
});

test("session restores a local XC credential while logout revokes shared access before clearing the cookie", async () => {
  const calls: string[] = [];
  const fetcher = async (target: string, options: RequestInit) => {
    const path = new URL(target).pathname;
    calls.push(path);
    assert.equal(new Headers(options.headers).get("Authorization"), `Bearer ${gzToken}`);
    return path.endsWith("/sso/bridge") ? reply(bridge) : path.endsWith("/logout") ? reply({ ok: true }) : reply({}, 404);
  };
  const cookie = `__Secure-pithiest-fenbi=${gzToken}`;
  const session = await handleSsoRequest(request("session", undefined, cookie), fetcher);
  assert.equal(session.status, 200);
  assert.deepEqual(await session.json(), { token: xcToken, account: bridge.xc.account });
  const logout = await handleSsoRequest(request("logout", {}, cookie), fetcher);
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("Set-Cookie") || "", /Max-Age=0/);
  assert.deepEqual(calls.map(path => path.split("/").at(-1)), ["bridge", "logout"]);
});

test("rejected origins, malformed input, and ambiguous cookies never reach the identity service", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return reply(bridge); };
  assert.equal((await handleSsoRequest(request("start", {}, undefined, "https://evil.invalid"), fetcher)).status, 403);
  assert.equal((await handleSsoRequest(new Request(url("start"), { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), fetcher)).status, 403);
  assert.equal((await handleSsoRequest(request("poll", { challenge: "bad" }), fetcher)).status, 400);
  assert.equal((await handleSsoRequest(request("session", undefined, `__Secure-pithiest-fenbi=${gzToken}; __Secure-pithiest-fenbi=${gzToken}`), fetcher)).status, 401);
  assert.equal((await handleSsoRequest(new Request(`${url("session")}&owner=another`), fetcher)).status, 404);
  assert.equal(calls, 0);
});

test("pending QR responses expose only status, and an incomplete bridge cannot set the shared cookie", async () => {
  const pending = await handleSsoRequest(request("poll", { challenge }), async () => reply({ status: 1, token: gzToken }));
  assert.deepEqual(await pending.json(), { status: 1 });
  const incomplete = await handleSsoRequest(request("poll", { challenge }), async target => {
    const path = new URL(target).pathname;
    return path.endsWith("/login/poll") ? reply({ status: 3, token: gzToken }) : reply({ xc: { token: xcToken, account: { accountId: "xc-account" } }, gz: {} });
  });
  assert.equal(incomplete.status, 503);
  assert.equal(incomplete.headers.get("Set-Cookie"), null);
  assert.ok(!(await incomplete.text()).includes(gzToken));
});

test("failed remote logout keeps the cookie so the user can retry without a false success", async () => {
  const response = await handleSsoRequest(request("logout", {}, `__Secure-pithiest-fenbi=${gzToken}`), async () => reply({ error: "synthetic outage" }, 503));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Set-Cookie"), null);
  assert.deepEqual(await response.json(), { error: "云端注销暂未完成，请重试。" });
});

test("expired shared session clears its cookie without returning an XC token", async () => {
  const response = await handleSsoRequest(request("session", undefined, `__Secure-pithiest-fenbi=${gzToken}`), async () => reply({ error: "expired" }, 401));
  assert.equal(response.status, 401);
  assert.match(response.headers.get("Set-Cookie") || "", /Max-Age=0/);
  assert.ok(!(await response.text()).includes(xcToken));
});

test("QR start forwards only a bounded Vercel client IP for upstream rate limiting", async () => {
  const forwarded: Array<{ path: string; ip: string | null; origin: string | null; cookie: string | null; auth: string | null }> = [];
  const fetcher = async (target: string, options: RequestInit) => {
    const headers = new Headers(options.headers);
    forwarded.push({ path: new URL(target).pathname, ip: headers.get("x-forwarded-for"), origin: headers.get("origin"), cookie: headers.get("cookie"), auth: headers.get("authorization") });
    return new URL(target).pathname.endsWith("/login/start")
      ? reply({ challenge, codeContent: "synthetic-qr", expiresAt: "2026-09-23T10:00:00Z" })
      : reply({ status: 1 });
  };
  const startRequest = (vercelIp: string) => new Request(url("start"), {
    method: "POST",
    headers: { Origin: "https://xc.pithiest.cn", "Content-Type": "application/json", "X-Vercel-Forwarded-For": vercelIp,
      "X-Forwarded-For": "198.51.100.99", Cookie: `__Secure-pithiest-fenbi=${gzToken}`, Authorization: `Bearer ${gzToken}` },
    body: "{}",
  });
  assert.equal((await handleSsoRequest(startRequest("203.0.113.42"), fetcher)).status, 200);
  assert.deepEqual(forwarded[0], { path: "/functions/v1/gz-fenbi/login/start", ip: "203.0.113.42", origin: null, cookie: null, auth: null });
  assert.equal((await handleSsoRequest(startRequest("2001:0db8:0:0:0:0:0:1"), fetcher)).status, 200);
  assert.equal(forwarded[1].ip, "2001:0db8:0:0:0:0:0:1");
  for (const invalid of ["203.0.113.256", "203.0.113.42, 198.51.100.1", "1.2.3.4 other", "x".repeat(46)]) {
    assert.equal((await handleSsoRequest(startRequest(invalid), fetcher)).status, 200);
    assert.equal(forwarded.at(-1)?.ip, null);
  }
  assert.equal((await handleSsoRequest(request("poll", { challenge }), fetcher)).status, 200);
  assert.equal(forwarded.at(-1)?.ip, null);
});
