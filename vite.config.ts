import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "pithiest-first-paint",
      transformIndexHtml(html) {
        return html
          .replace(/<script type="module" crossorigin src=/g, `<script type="module" crossorigin fetchpriority="high" src=`)
          .replace(/<link rel="modulepreload" crossorigin href=/g, `<link rel="modulepreload" crossorigin fetchpriority="high" href=`);
      }
    }
  ],
  build: {
    target: "es2020",
    sourcemap: false,
    chunkSizeWarningLimit: 650,
    modulePreload: {
      resolveDependencies(filename, deps, context) {
        if (context.hostType === "html" || filename.includes("index")) {
          return deps.filter((dep) => !dep.includes("charts-") && !dep.includes("Charts-"));
        }
        return deps;
      }
    },
    rollupOptions: {}
  }
});
