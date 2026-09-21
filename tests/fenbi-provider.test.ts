import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import {
  getIdentity, pollQr, ProviderError, readAnswers, readQuestionBatch, readTree, registerDevice, startQr
} from "../supabase/functions/fenbi-cloud/provider.ts";
import type { CookieJar, DeviceRegistration } from "../supabase/functions/fenbi-cloud/provider.ts";

// Every test replaces fetch before calling the provider. These are synthetic fixtures,
// never calls to Fenbi and never browser/login/session access.
function json(value: unknown, status = 200, cookieHeaders: string[] = []) {
  const headers = new Headers({ "Content-Type": "application/json" });
  for (const cookie of cookieHeaders) headers.append("Set-Cookie", cookie);
  return new Response(JSON.stringify(value), { status, headers });
}

function mockFetch(t: TestContext, run: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  return t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init: RequestInit = {}) => {
    assert.equal(init.redirect, "error", "provider must not follow a redirect with credentials");
    assert.equal(init.credentials, "omit", "provider must use its explicit isolated cookie jar");
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.protocol, "https:");
    return run(url, init);
  });
}

test("QR generation and polling use the fixed first-party contract without browser credentials", async (t) => {
  const fetch = mockFetch(t, (url, init) => {
    assert.equal(url.origin, "https://ke.fenbi.com");
    assert.equal(new Headers(init.headers).has("Cookie"), false);
    if (url.pathname === "/qrcode-login/api/gen_code") {
      assert.equal(init.method, "GET");
      assert.equal(url.searchParams.has("random"), true);
      return json({ code: 1, msg: "", data: { lgtoken: "synthetic-only-transaction", codeContent: "https://www.fenbi.com/synthetic-only" } });
    }
    assert.equal(url.pathname, "/qrcode-login/api/query_code_status");
    assert.equal(init.method, "POST");
    assert.equal(new Headers(init.headers).get("Content-Type"), "application/json");
    assert.deepEqual(JSON.parse(String(init.body)), { lgtoken: "synthetic-only-transaction" });
    return json({ code: 1, msg: "", data: 1 });
  });
  const qr = await startQr();
  assert.equal(qr.cookies.length, 0);
  assert.equal((await pollQr(qr.lgtoken, qr.cookies)).status, 1);
  assert.equal(fetch.mock.callCount(), 2);
});

test("Cookie jar respects host-only, domain, path, expiry and refuses foreign-domain cookies", async (t) => {
  const jar: CookieJar = [];
  mockFetch(t, (url, init) => {
    const sent = new Headers(init.headers).get("Cookie") || "";
    if (url.hostname === "ke.fenbi.com") {
      return json({ code: 1, data: 3 }, 200, [
        "shared=synthetic; Domain=fenbi.com; Path=/; Secure; HttpOnly",
        "ke_only=synthetic; Path=/; Secure; HttpOnly",
        "question_path=synthetic; Domain=.fenbi.com; Path=/api/xingce",
        "wrong_path=synthetic; Domain=.fenbi.com; Path=/api/xingce/error",
        "foreign=synthetic; Domain=example.com; Path=/",
        "sibling=synthetic; Domain=tiku.fenbi.com; Path=/",
        "suffix=synthetic; Domain=com; Path=/",
        "expired=synthetic; Domain=.fenbi.com; Path=/; Max-Age=0",
        "past=synthetic; Domain=.fenbi.com; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT"
      ]);
    }
    if (url.hostname === "login.fenbi.com") {
      assert.equal(sent, "shared=synthetic");
      return json({ userId: 12345, identity: "合成测试昵称" });
    }
    assert.equal(url.hostname, "tiku.fenbi.com");
    assert.equal(sent, "question_path=synthetic; shared=synthetic");
    return json([]);
  });
  await pollQr("synthetic-only", jar);
  assert.deepEqual(jar.map(cookie => [cookie.name, cookie.domain]), [
    ["shared", ".fenbi.com"], ["ke_only", "ke.fenbi.com"],
    ["question_path", ".fenbi.com"], ["wrong_path", ".fenbi.com"]
  ]);
  // Old persisted cookies with epoch expiry must not be mistaken for session cookies.
  jar.push({ name: "epoch_expiry", value: "synthetic", domain: ".fenbi.com", path: "/", expires: 0 });
  assert.deepEqual(await getIdentity(jar), { providerId: "12345", displayName: "合成测试昵称" });
  assert.deepEqual(await readTree(jar), []);
});

test("updated and deleted Set-Cookie values mutate only their matching jar entry", async (t) => {
  const jar: CookieJar = [
    { name: "shared", value: "synthetic-old", domain: ".fenbi.com", path: "/" },
    { name: "shared", value: "synthetic-host", domain: "ke.fenbi.com", path: "/" },
    { name: "erase", value: "synthetic", domain: ".fenbi.com", path: "/" }
  ];
  mockFetch(t, () => json({ code: 1, data: 2 }, 200, [
    "shared=synthetic-new; Domain=fenbi.com; Path=/; Max-Age=3600",
    "erase=; Domain=fenbi.com; Path=/; Max-Age=-1"
  ]));
  const poll = await pollQr("synthetic-only", jar);
  assert.equal(poll.cookies, jar);
  assert.deepEqual(jar.map(cookie => [cookie.name, cookie.value, cookie.domain]), [
    ["shared", "synthetic-host", "ke.fenbi.com"], ["shared", "synthetic-new", ".fenbi.com"]
  ]);
  assert.ok(jar[1].expires! > Date.now());
});

test("identity is accepted only from the official info fields and stable numeric ID", async (t) => {
  const payloads: unknown[] = [
    { userId: "12345", identity: " 合成测试昵称 ", phone: "not-retained" },
    { id: 12345, nickname: "unverified-schema" },
    { data: { userId: 12345, identity: "unexpected-wrapper" } },
    { userId: 0, identity: "invalid-id" },
    { userId: Number.MAX_SAFE_INTEGER + 1, identity: "unsafe-numeric-id" }
  ];
  mockFetch(t, (url, init) => {
    assert.equal(url.href, "https://login.fenbi.com/api/users/info");
    assert.equal(init.method, "GET");
    return json(payloads.shift());
  });
  assert.deepEqual(await getIdentity([]), { providerId: "12345", displayName: "合成测试昵称" });
  for (let i = 0; i < 4; i++) await assert.rejects(getIdentity([]), error => error instanceof ProviderError && error.code === "INVALID_RESPONSE");
});

test("authenticated reads stay within fixed tree, question and answer routes and requested IDs", async (t) => {
  const routes: string[] = [];
  mockFetch(t, (url, init) => {
    assert.equal(url.origin, "https://tiku.fenbi.com");
    assert.equal(init.method, "GET");
    assert.equal(url.searchParams.get("app"), "web");
    routes.push(url.pathname);
    if (url.pathname.endsWith("keypoint-tree")) {
      assert.equal(url.searchParams.get("timeRange"), "0");
      assert.equal(url.searchParams.get("order"), "desc");
      return json([{ name: "合成模块", questionIds: [100, 101], children: null }]);
    }
    if (url.pathname.endsWith("solutions")) {
      assert.equal(url.searchParams.get("questionIds"), "100,101");
      assert.equal(url.searchParams.get("type"), "1");
      return json({ solutions: [{ id: 100 }, { id: 101 }], materials: [], q2subQuestionIds: null });
    }
    assert.equal(url.pathname, "/api/xingce/user-answers");
    assert.equal(url.searchParams.get("ids"), "100,101");
    return json([{ questionId: 100, answer: { choice: "0" } }]);
  });
  assert.equal((await readTree([])).length, 1);
  assert.deepEqual((await readQuestionBatch([], [100, "101"])).requestedIds, ["100", "101"]);
  assert.equal((await readAnswers([], [100, 101])).length, 1);
  assert.deepEqual(routes, ["/api/xingce/errors/keypoint-tree", "/api/xingce/universal/auth/solutions", "/api/xingce/user-answers"]);
});

test("CDN fetch discards unrelated URLs and never carries account credentials", async (t) => {
  const jar: CookieJar = [{ name: "shared", value: "synthetic-private", domain: ".fenbi.com", path: "/" }];
  const urls: string[] = [];
  mockFetch(t, (url, init) => {
    urls.push(url.hostname);
    if (url.hostname === "tiku.fenbi.com") {
      assert.equal(new Headers(init.headers).get("Cookie"), "shared=synthetic-private");
      return json({ cdnUrls: ["https://files.fbstatic.cn.evil.test/ignored", "https://files.fbstatic.cn/synthetic"] });
    }
    assert.equal(url.hostname, "files.fbstatic.cn");
    assert.deepEqual([...new Headers(init.headers).keys()], ["accept"]);
    assert.equal(init.method, "GET");
    return json({ solutions: [{ id: 100 }], materials: [] }, 200, ["must_not_store=synthetic; Domain=.fenbi.com; Path=/"]);
  });
  assert.equal((await readQuestionBatch(jar, [100])).solutions.length, 1);
  assert.deepEqual(urls, ["tiku.fenbi.com", "files.fbstatic.cn"]);
  assert.equal(jar.length, 1, "unrelated CDN must not change the account jar");
});

test("authentication, verification and rate limiting stop immediately with sanitized errors", async (t) => {
  const cases = [
    [401, "AUTH_REQUIRED"], [403, "AUTH_REQUIRED"], [430, "VERIFICATION_REQUIRED"],
    [432, "VERIFICATION_REQUIRED"], [453, "VERIFICATION_REQUIRED"], [429, "RATE_LIMITED"]
  ] as const;
  let index = 0;
  const fetch = mockFetch(t, () => json({ token: "synthetic-secret-not-for-errors" }, cases[index++][0]));
  for (const [, code] of cases) await assert.rejects(readTree([]), error => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.code, code);
    assert.equal(`${error.message}${JSON.stringify(error)}`.includes("synthetic-secret"), false);
    return true;
  });
  assert.equal(fetch.mock.callCount(), cases.length, "there must be no automatic retry of blocked requests");
});

test("invalid batches never fetch and out-of-batch provider records are rejected", async (t) => {
  const fetch = mockFetch(t, url => url.pathname.endsWith("solutions")
    ? json({ solutions: [{ id: 999 }], materials: [] })
    : json([{ questionId: 999, answer: { choice: "0" } }]));
  for (const ids of [[], [100, 100], ["not-a-number"], Array.from({ length: 11 }, (_, i) => i + 1)]) {
    await assert.rejects(readQuestionBatch([], ids), error => error instanceof ProviderError && error.code === "INVALID_REQUEST");
    await assert.rejects(readAnswers([], ids), error => error instanceof ProviderError && error.code === "INVALID_REQUEST");
  }
  assert.equal(fetch.mock.callCount(), 0);
  await assert.rejects(readQuestionBatch([], [100]), error => error instanceof ProviderError && error.code === "INVALID_RESPONSE");
  await assert.rejects(readAnswers([], [100]), error => error instanceof ProviderError && error.code === "INVALID_RESPONSE");
  assert.equal(fetch.mock.callCount(), 2);
});

test("unexpected JSON login status and network errors do not expose bodies or URLs", async (t) => {
  let call = 0;
  mockFetch(t, () => {
    if (call++ === 0) return json({ code: 430, sensitive: "synthetic-private-body" });
    if (call === 2) return json({ code: 1, data: 12345 });
    throw new Error("synthetic-private-url-and-token");
  });
  await assert.rejects(readTree([]), error => error instanceof ProviderError && error.code === "VERIFICATION_REQUIRED" && !error.message.includes("synthetic-private"));
  await assert.rejects(pollQr("synthetic-only", []), error => error instanceof ProviderError && error.code === "INVALID_RESPONSE");
  await assert.rejects(readTree([]), error => error instanceof ProviderError && error.code === "NETWORK" && !error.message.includes("synthetic-private"));
});

function syntheticDevice(): DeviceRegistration {
  return { startupId: "synthetic-browser-startup-id", extras: { canvas: "synthetic-canvas-hash", webgl: "Synthetic Vendor~Synthetic Renderer", screen: "1000x800x24", language: "zh-CN", platform: "SyntheticOS", cores: "8", memory: "8", touchPoints: "0" } };
}

test("device registration forwards browser values to the official route and keeps the updated isolated cookie jar", async t => {
  const input = syntheticDevice();
  const jar: CookieJar = [
    { name: "session", value: "synthetic-old", domain: ".fenbi.com", path: "/" },
    { name: "tiku_only", value: "synthetic-host", domain: "tiku.fenbi.com", path: "/" }
  ];
  const fetch = mockFetch(t, (url, init) => {
    assert.equal(url.href, "https://login.fenbi.com/api/users/device/sid/create");
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(String(init.body)), { pf: "web", ...input });
    assert.equal(new Headers(init.headers).get("Cookie"), "session=synthetic-old");
    return json({ code: 1, data: { deviceId: "synthetic-provider-issued-device-id" } }, 200, ["session=synthetic-new; Domain=fenbi.com; Path=/; Max-Age=3600"]);
  });
  assert.equal(await registerDevice(jar, input), "synthetic-provider-issued-device-id");
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(jar.find(cookie => cookie.name === "session")?.value, "synthetic-new");
  assert.equal(jar.find(cookie => cookie.name === "tiku_only")?.value, "synthetic-host");
});

test("registered device IDs are sent only when present on all three authenticated read routes", async t => {
  const seen: Array<string | null> = [];
  mockFetch(t, url => {
    seen.push(url.searchParams.get("deviceId"));
    if (url.pathname.endsWith("solutions")) return json({ solutions: [{ id: 100 }], materials: [] });
    return json([]);
  });
  for (const deviceId of [undefined, "", "synthetic-device-id"]) {
    await readTree([], deviceId);
    await readQuestionBatch([], [100], deviceId);
    await readAnswers([], [100], deviceId);
  }
  assert.deepEqual(seen, [null, null, null, null, null, null, "synthetic-device-id", "synthetic-device-id", "synthetic-device-id"]);
});

test("device registration rejects malformed browser inputs and invalid IDs before further requests", async t => {
  const fetch = mockFetch(t, () => json({ code: 1, data: { deviceId: "synthetic-device-id" } }));
  const missing = syntheticDevice();
  delete (missing.extras as Partial<DeviceRegistration["extras"]>).canvas;
  for (const input of [null, {}, { ...syntheticDevice(), startupId: "" }, { ...syntheticDevice(), startupId: "bad\nvalue" }, missing, { ...syntheticDevice(), extras: { ...syntheticDevice().extras, cores: 8 } }]) {
    await assert.rejects(registerDevice([], input as DeviceRegistration), error => error instanceof ProviderError && error.code === "INVALID_REQUEST");
  }
  for (const deviceId of ["bad id", "bad\nvalue", "x".repeat(2049)]) {
    await assert.rejects(readTree([], deviceId), error => error instanceof ProviderError && error.code === "INVALID_REQUEST");
    await assert.rejects(readQuestionBatch([], [100], deviceId), error => error instanceof ProviderError && error.code === "INVALID_REQUEST");
    await assert.rejects(readAnswers([], [100], deviceId), error => error instanceof ProviderError && error.code === "INVALID_REQUEST");
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("device registration accepts only the returned official device ID and never manufactures a fallback", async t => {
  const payloads = [
    { code: 0, data: { deviceId: "synthetic-unaccepted" } },
    { code: 1, data: { deviceId: "" } },
    { code: 1, data: { deviceId: 12345 } },
    { code: 1, data: { id: "wrong-field" } },
    { code: 1, deviceId: "wrong-level" },
    { code: 1, data: { deviceId: "contains whitespace" } }
  ];
  const fetch = mockFetch(t, () => json(payloads.shift()));
  for (let index = 0; index < 6; index++) await assert.rejects(registerDevice([], syntheticDevice()), error => error instanceof ProviderError && error.code === "INVALID_RESPONSE");
  assert.equal(fetch.mock.callCount(), 6, "No registration retry or synthetic fallback is allowed");
});

test("device registration preserves verification errors and does not retry them", async t => {
  const fetch = mockFetch(t, () => json({ private: "synthetic-only" }, 453));
  await assert.rejects(registerDevice([], syntheticDevice()), error => error instanceof ProviderError && error.code === "VERIFICATION_REQUIRED" && error.httpStatus === 453 && !error.message.includes("synthetic-only"));
  assert.equal(fetch.mock.callCount(), 1);
});
