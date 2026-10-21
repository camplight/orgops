import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const basePath = process.env.VITE_UI_BASE_PATH ?? "/";
const appRoot = dirname(fileURLToPath(import.meta.url));
const apiProxyTarget = process.env.ORGOPS_DEV_API_PROXY_TARGET ?? "http://localhost:8787";
const wsProxyTarget = process.env.ORGOPS_DEV_WS_PROXY_TARGET ?? "ws://localhost:8787";

export default defineConfig({
  root: appRoot,
  base: basePath,
  plugins: [react()],
  server: {
    port: 5190,
    proxy: {
      "/api": apiProxyTarget,
      "/agents": apiProxyTarget,
      "/agent": apiProxyTarget,
      "/ws": {
        target: wsProxyTarget,
        ws: true
      }
    }
  },
  preview: {
    port: 4190
  }
});
