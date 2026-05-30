import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-dom/client", "scheduler"]
        }
      }
    }
  }
});
