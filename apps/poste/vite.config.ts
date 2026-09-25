import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;
const rootDir = path.dirname(fileURLToPath(import.meta.url));

const instanceProxy = {
  "/api": {
    target: process.env.LEGALOS_INSTANCE_PROXY ?? "http://127.0.0.1:8088",
    changeOrigin: true,
  },
  "/sync": {
    target: process.env.LEGALOS_INSTANCE_PROXY ?? "http://127.0.0.1:8088",
    changeOrigin: true,
    ws: true,
  },
};

export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "src"),
    },
  },
  clearScreen: false,
  preview: {
    proxy: instanceProxy,
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
    proxy: instanceProxy,
  },
}));
