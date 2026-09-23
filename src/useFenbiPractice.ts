import { useCallback, useEffect, useRef, useState } from "react";
import {
  FENBI_SESSION_KEY, getFenbiAccount, getFenbiPractices, readFenbiSession, reviewFenbiPractice,
  storeFenbiSession, syncFenbiNow, MistakeApiError, mistakeErrorMessage,
} from "./mistakeApi";
import type { FenbiAccount, FenbiSession } from "./mistakeApi";
import { completePracticeHistory, markPracticeReviewed } from "./fenbiPractice";
import type { FenbiPractice, PracticeHistoryPage } from "./fenbiPractice";

const PRACTICE_REVIEW_DELAY = 5_000;
const PRACTICE_REVIEW_RETRY_DELAY = 120_000;
const PRACTICE_HISTORY_POLL_INTERVAL = 120_000;

type PracticeSnapshot = { owner: string; items: FenbiPractice[] };
type CachedPracticeSnapshot = PracticeSnapshot & { stamp?: string | null; pendingReviews?: string[] };

function practiceCacheKey(owner: string) { return `xc-fenbi-practice-v1:${owner}`; }
function writePracticeCache(owner: string, items: FenbiPractice[], stamp: string | null | undefined, pendingReviews: Set<string>) {
  try {
    localStorage.setItem(practiceCacheKey(owner), JSON.stringify({ owner, items, stamp, pendingReviews: [...pendingReviews] }));
    return true;
  } catch { return false; }
}

export function useFenbiPractice() {
  const [session, setSession] = useState<FenbiSession | null>(readFenbiSession);
  const [snapshot, setSnapshot] = useState<PracticeSnapshot>({ owner: "", items: [] });
  const [account, setAccount] = useState<FenbiAccount | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const snapshotRef = useRef(snapshot);
  const mountedToken = useRef(session?.token);
  mountedToken.current = session?.token;
  const pendingReviewKeys = useRef(new Set<string>());
  const cacheStamp = useRef<{ owner: string; value: string | null | undefined }>({ owner: "", value: undefined });
  const reviewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reviewControllers = useRef(new Set<AbortController>());
  const flushReviews = useRef<() => Promise<void>>(async () => {});
  const scheduleReviews = useRef<(delay?: number) => void>(() => {});

  const replaceSnapshot = (next: PracticeSnapshot) => {
    snapshotRef.current = next;
    setSnapshot(next);
  };

  useEffect(() => {
    const changed = () => setSession(readFenbiSession());
    const storage = (event: StorageEvent) => { if (!event.key || event.key === FENBI_SESSION_KEY) changed(); };
    window.addEventListener("fenbi-session-change", changed);
    window.addEventListener("storage", storage);
    return () => {
      window.removeEventListener("fenbi-session-change", changed);
      window.removeEventListener("storage", storage);
    };
  }, []);

  useEffect(() => {
    setAccount(null);
    setError("");
    if (!session) {
      pendingReviewKeys.current = new Set();
      cacheStamp.current = { owner: "", value: undefined };
      replaceSnapshot({ owner: "", items: [] });
      return;
    }

    const controller = new AbortController();
    const token = session.token;
    const owner = session.accountId;
    let alive = true;
    let busy = false;
    let lastCheck = 0;
    let stamp: string | null | undefined;
    let flushingReviews = false;

    try {
      const cached = JSON.parse(localStorage.getItem(practiceCacheKey(owner)) || "null") as CachedPracticeSnapshot | null;
      if (cached?.owner === owner && Array.isArray(cached.items)) {
        stamp = cached.stamp;
        cacheStamp.current = { owner, value: stamp };
        replaceSnapshot({ owner, items: cached.items });
        pendingReviewKeys.current = new Set(Array.isArray(cached.pendingReviews)
          ? cached.pendingReviews.filter((key) => typeof key === "string" && key.length > 0 && key.length <= 2048)
          : []);
      } else {
        cacheStamp.current = { owner, value: undefined };
        pendingReviewKeys.current = new Set();
      }
    } catch {
      cacheStamp.current = { owner, value: undefined };
      pendingReviewKeys.current = new Set();
    }

    const persist = (items: FenbiPractice[], nextStamp = stamp) => {
      if (!writePracticeCache(owner, items, nextStamp, pendingReviewKeys.current)) {
        setError("当前设备暂时不能缓存完整练习或复盘标记；本机存储恢复后可继续同步。");
        return false;
      }
      return true;
    };

    const schedule = (delay = PRACTICE_REVIEW_DELAY) => {
      if (!alive || !pendingReviewKeys.current.size || !navigator.onLine) return;
      if (reviewTimer.current) clearTimeout(reviewTimer.current);
      reviewTimer.current = setTimeout(() => {
        reviewTimer.current = null;
        void flushReviews.current();
      }, delay);
    };
    scheduleReviews.current = schedule;

    const pull = async (force = false) => {
      if (!alive || busy || !navigator.onLine || (!force && Date.now() - lastCheck < PRACTICE_HISTORY_POLL_INTERVAL)) return;
      lastCheck = Date.now();
      busy = true;
      setLoading(true);
      try {
        const status = await getFenbiAccount(token, controller.signal);
        if (!alive) return;
        if (status.accountId !== owner) throw new MistakeApiError("账号状态变化，请重新登录。", 401);
        setAccount(status);

        // The worker writes exercise rows as it processes history pages. Never cache those rows
        // until the account reports completion and every page has the same owner and version.
        const historyStable = !["queued", "syncing"].includes(status.syncState);
        if (status.historyComplete === true && historyStable && (stamp !== status.historyUpdatedAt || stamp === undefined)) {
          const pages: PracticeHistoryPage[] = [];
          let offset: number | null = 0;
          let pagesRead = 0;
          while (offset !== null) {
            if (pagesRead++ > 1000) throw new Error("pagination exceeded");
            const page = await getFenbiPractices(token, offset, controller.signal);
            if (!alive) return;
            if (!Array.isArray(page.items) || !page.account || page.account.accountId !== owner) throw new Error("incomplete practice page");
            pages.push({ offset, items: page.items, next: page.next, account: page.account });
            offset = page.next;
          }
          const complete = completePracticeHistory(status, pages);
          if (!complete) {
            const latestPageAccount = pages.at(-1)?.account;
            if (latestPageAccount?.accountId === owner) setAccount(latestPageAccount as FenbiAccount);
            setError("练习历史在读取期间发生变化，已保留上次完整记录；稍后会自动重试。");
          } else {
            const previous = new Map<string, FenbiPractice>();
            if (snapshotRef.current.owner === owner) {
              for (const item of snapshotRef.current.items) previous.set(item.key, item);
            }
            const visible = complete.map((item) => {
              const local = previous.get(item.key);
              return pendingReviewKeys.current.has(item.key) && local?.reviewedAt
                ? { ...item, reviewedAt: local.reviewedAt }
                : item;
            });
            stamp = status.historyUpdatedAt;
            cacheStamp.current = { owner, value: stamp };
            replaceSnapshot({ owner, items: visible });
            if (persist(visible, stamp)) setError("");
          }
        }

        if (["idle", "error"].includes(status.syncState)
          && (!status.lastAttempt || Date.now() - Date.parse(status.lastAttempt) > 15 * 60_000)) {
          await syncFenbiNow(token, controller.signal);
        }
      } catch (failure) {
        if (!alive) return;
        if (failure instanceof MistakeApiError && failure.status === 401) {
          if (readFenbiSession()?.token === token) storeFenbiSession(null);
        } else setError(mistakeErrorMessage(failure));
      } finally {
        busy = false;
        if (alive) setLoading(false);
      }
    };

    const flushPendingReviews = async () => {
      if (!alive || flushingReviews || !pendingReviewKeys.current.size || !navigator.onLine) return;
      flushingReviews = true;
      let persistenceFailed = false;
      try {
        for (const key of [...pendingReviewKeys.current]) {
          if (!alive || controller.signal.aborted || mountedToken.current !== token) return;
          const request = new AbortController();
          reviewControllers.current.add(request);
          try {
            const result = await reviewFenbiPractice(token, key, request.signal);
            if (!alive || request.signal.aborted || mountedToken.current !== token) return;
            pendingReviewKeys.current.delete(key);
            const current = snapshotRef.current;
            if (current.owner === owner) {
              const items = markPracticeReviewed(current.items, key, result.reviewedAt);
              replaceSnapshot({ owner, items });
              if (!persist(items)) persistenceFailed = true;
            }
          } catch (failure) {
            if (!alive || request.signal.aborted || mountedToken.current !== token) return;
            if (failure instanceof MistakeApiError && failure.status === 401) {
              if (readFenbiSession()?.token === token) storeFenbiSession(null);
              return;
            }
            setError(mistakeErrorMessage(failure));
            schedule(PRACTICE_REVIEW_RETRY_DELAY);
            return;
          } finally {
            reviewControllers.current.delete(request);
          }
        }
        if (alive && pendingReviewKeys.current.size === 0 && !persistenceFailed) setError("");
      } finally {
        flushingReviews = false;
        if (alive && pendingReviewKeys.current.size && navigator.onLine && !reviewTimer.current) {
          schedule(PRACTICE_REVIEW_RETRY_DELAY);
        }
      }
    };
    flushReviews.current = flushPendingReviews;

    if (pendingReviewKeys.current.size) schedule();
    void pull(true);
    const interval = setInterval(() => { if (!document.hidden) void pull(); }, 15_000);
    const online = () => {
      void pull(true);
      schedule();
    };
    const focus = () => { void pull(); schedule(); };
    window.addEventListener("online", online);
    window.addEventListener("focus", focus);
    return () => {
      alive = false;
      controller.abort();
      clearInterval(interval);
      if (reviewTimer.current) clearTimeout(reviewTimer.current);
      reviewTimer.current = null;
      for (const request of reviewControllers.current) request.abort();
      reviewControllers.current.clear();
      scheduleReviews.current = () => {};
      flushReviews.current = async () => {};
      window.removeEventListener("online", online);
      window.removeEventListener("focus", focus);
    };
  }, [session?.token, session?.accountId, revision]);

  const markReviewed = async (key: string) => {
    if (!session || snapshotRef.current.owner !== session.accountId) return;
    const practice = snapshotRef.current.items.find((item) => item.key === key);
    if (!practice || practice.reviewedAt) return;

    const previousPending = new Set(pendingReviewKeys.current);
    pendingReviewKeys.current.add(key);
    const reviewedAt = new Date().toISOString();
    const items = markPracticeReviewed(snapshotRef.current.items, key, reviewedAt);
    const stamp = cacheStamp.current.owner === session.accountId ? cacheStamp.current.value : undefined;
    if (!writePracticeCache(session.accountId, items, stamp, pendingReviewKeys.current)) {
      pendingReviewKeys.current = previousPending;
      setError("复盘标记未能保存在本机，请检查浏览器存储后重试；尚未同步到云端。");
      return;
    }
    replaceSnapshot({ owner: session.accountId, items });
    setError("");
    scheduleReviews.current(PRACTICE_REVIEW_DELAY);
  };

  return {
    session,
    items: snapshot.owner === session?.accountId ? snapshot.items : [],
    account: account?.accountId === session?.accountId ? account : null,
    error,
    loading,
    refresh,
    markReviewed,
  };
}
