import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const basePath = process.env.VITE_UI_BASE_PATH ?? "/";
const appRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: appRoot,
  base: basePath,
  plugins: [react()],
  server: {
    port: 5190,
    proxy: {
      "/api": "http://localhost:8787",
      "/ws": {
        target: "ws://localhost:8787",
        ws: true
      }
    }
  },
  preview: {
    port: 4190
  }
});
