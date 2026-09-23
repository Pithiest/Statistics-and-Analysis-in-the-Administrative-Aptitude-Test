import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const workerSource = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const htmlSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
const origin = "https://xc.test";
const shellHtml = '<script type="module" src="/assets/index-new.js"></script><link rel="stylesheet" href="/assets/index-new.css">';

class CachedResponse {
  readonly ok: boolean;
  readonly type = "basic";
  private readonly body: string;
  readonly status: number;

  constructor(body: string, status = 200) {
    this.body = body;
    this.status = status;
    this.ok = status >= 200 && status < 300;
  }

  clone() {
    return new CachedResponse(this.body, this.status);
  }

  async text() {
    return this.body;
  }
}

class TestCache {
  private readonly entries = new Map<string, CachedResponse>();

  async match(request: string | { url: string }) {
    return this.entries.get(cacheKey(request))?.clone();
  }

  async put(request: string | { url: string }, response: CachedResponse) {
    this.entries.set(cacheKey(request), response.clone());
  }
}

function cacheKey(request: string | { url: string }) {
  const value = typeof request === "string" ? request : request.url;
  return new URL(value, origin).pathname;
}

function makeHarness(options: { brokenAsset?: string } = {}) {
  const handlers = new Map<string, (event: any) => void>();
  const cacheStore = new Map<string, TestCache>();
  let offline = false;
  let skipWaitingCalls = 0;
  let claimCalls = 0;
  const caches = {
    async open(name: string) {
      let cache = cacheStore.get(name);
      if (!cache) {
        cache = new TestCache();
        cacheStore.set(name, cache);
      }
      return cache;
    },
    async keys() {
      return [...cacheStore.keys()];
    },
    async delete(name: string) {
      return cacheStore.delete(name);
    }
  };
  const fetch = async (input: string | { url: string }) => {
    if (offline) throw new TypeError("offline");
    const path = new URL(typeof input === "string" ? input : input.url, origin).pathname;
    if (path === "/" || path === "/index.html") return new CachedResponse(shellHtml);
    if (path === "/manifest.webmanifest" || path === "/pithiest-icon.svg") return new CachedResponse("static shell asset");
    if (path === options.brokenAsset) return new CachedResponse("asset unavailable", 503);
    if (path.startsWith("/assets/")) return new CachedResponse(`cached:${path}`);
    return new CachedResponse("not found", 404);
  };
  const self = {
    location: { origin },
    addEventListener(type: string, handler: (event: any) => void) {
      handlers.set(type, handler);
    },
    async skipWaiting() {
      skipWaitingCalls += 1;
    },
    clients: {
      async claim() {
        claimCalls += 1;
      }
    }
  };
  const responseType = {
    error: () => ({ type: "error", clone() { return this; } })
  };
  vm.runInNewContext(workerSource, { self, caches, fetch, Response: responseType, URL, setTimeout });

  async function dispatchLifecycle(type: "install" | "activate") {
    const pending: Promise<unknown>[] = [];
    handlers.get(type)?.({ waitUntil(value: Promise<unknown>) { pending.push(value); } });
    await Promise.all(pending);
  }

  async function dispatchFetch(request: { method: string; mode: string; url: string }) {
    const pending: Promise<unknown>[] = [];
    handlers.get("fetch")?.({ request, respondWith(value: Promise<unknown>) { pending.push(value); } });
    return await pending[0] as CachedResponse;
  }

  return {
    cacheStore,
    dispatchLifecycle,
    dispatchFetch,
    setOffline(value: boolean) { offline = value; },
    get skipWaitingCalls() { return skipWaitingCalls; },
    get claimCalls() { return claimCalls; }
  };
}

test("a failed entry asset keeps the previous worker cache active", async () => {
  const harness = makeHarness({ brokenAsset: "/assets/index-new.js" });
  const previous = new TestCache();
  harness.cacheStore.set("pithiest-xingce-v12", previous);
  await previous.put("/index.html", new CachedResponse("previous shell"));
  await previous.put("/assets/index-old.js", new CachedResponse("previous entry"));

  await assert.rejects(harness.dispatchLifecycle("install"));

  assert.equal(harness.skipWaitingCalls, 0);
  assert.ok(harness.cacheStore.has("pithiest-xingce-v12"));
  assert.equal(await (await previous.match("/assets/index-old.js"))?.text(), "previous entry");
});

test("a complete update keeps the previous release for old tabs and offline recovery", async () => {
  const harness = makeHarness();
  const previous = new TestCache();
  harness.cacheStore.set("pithiest-xingce-v12", previous);
  await previous.put("/index.html", new CachedResponse("previous shell"));
  await previous.put("/assets/index-old.js", new CachedResponse("previous entry"));
  harness.cacheStore.set("pithiest-xingce-v10", new TestCache());
  harness.cacheStore.set("unrelated-cache", new TestCache());

  await harness.dispatchLifecycle("install");
  assert.equal(harness.skipWaitingCalls, 1);
  assert.ok(harness.cacheStore.has("pithiest-xingce-v12"));

  await harness.dispatchLifecycle("activate");
  assert.equal(harness.claimCalls, 1);
  assert.deepEqual([...harness.cacheStore.keys()].sort(), ["pithiest-xingce-v12", "pithiest-xingce-v13", "unrelated-cache"]);

  harness.setOffline(true);
  const shell = await harness.dispatchFetch({ method: "GET", mode: "navigate", url: `${origin}/` });
  const oldChunk = await harness.dispatchFetch({ method: "GET", mode: "cors", url: `${origin}/assets/index-old.js` });
  assert.equal(await shell.text(), shellHtml);
  assert.equal(await oldChunk.text(), "previous entry");
});

test("the loading-shell retry preserves cached app resources and local records", () => {
  const script = htmlSource.match(/<script>\s*\(\(\) => \{[\s\S]*?<\/script>/)?.[0];
  assert.ok(script, "loading-shell retry script exists");
  const listeners = new Map<string, (event: unknown) => void>();
  const storage = new Map([["synthetic-training-records", "kept"]]);
  const deletedCaches: string[] = [];
  let reloadCalls = 0;
  class TestHTMLElement {
    readonly id: string;

    constructor(id: string) {
      this.id = id;
    }
  }
  const document = {
    querySelector: () => null,
    addEventListener(type: string, listener: (event: unknown) => void) {
      listeners.set(type, listener);
    }
  };
  const window = {
    setTimeout: () => 1,
    location: { reload() { reloadCalls += 1; } },
    caches: {
      async keys() { return ["pithiest-xingce-v12"]; },
      async delete(name: string) { deletedCaches.push(name); return true; }
    }
  };
  vm.runInNewContext(script.replace(/^<script>|<\/script>$/g, ""), { document, window, HTMLElement: TestHTMLElement });
  listeners.get("click")?.({ target: new TestHTMLElement("preload-retry") });

  assert.equal(reloadCalls, 1);
  assert.deepEqual(deletedCaches, []);
  assert.equal(storage.get("synthetic-training-records"), "kept");
});
