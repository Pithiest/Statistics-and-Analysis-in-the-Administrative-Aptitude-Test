import React, { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";

type ErrorBoundaryState = { failed: boolean };

class RootErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[pithiest-runtime]", error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="runtime-fallback">
        <strong>页面加载异常</strong>
        <span>本机数据不会丢失。请刷新一次，系统会自动清理旧缓存。</span>
        <button onClick={() => reloadAfterRuntimeFailure("boundary", true)}>刷新恢复</button>
      </main>
    );
  }
}

window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  reloadAfterRuntimeFailure("preload");
});

window.addEventListener("error", (event) => {
  const message = String(event.message || "");
  if (message.includes("dynamically imported module") || message.includes("Failed to fetch")) {
    reloadAfterRuntimeFailure("chunk");
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>
);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  registerServiceWorker();
}

if (import.meta.env.DEV && "serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => registration.unregister());
  });
}

function registerServiceWorker() {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let refreshing = false;

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        registration.update().catch(() => {});
        if (registration.waiting && navigator.serviceWorker.controller) {
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
        }
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              worker.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });
      })
      .catch(() => {});
  });

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

function reloadAfterRuntimeFailure(reason: string, force = false) {
  const key = `pithiest-runtime-reload-${reason}`;
  if (!force && sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, "1");
  clearRuntimeCaches().finally(() => window.location.reload());
}

async function clearRuntimeCaches() {
  if (!("caches" in window)) return;
  const keys = await caches.keys();
  await Promise.all(keys.filter((key) => key.startsWith("pithiest-xingce-")).map((key) => caches.delete(key)));
}
