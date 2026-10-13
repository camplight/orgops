import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "user-ui",
    environment: "happy-dom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/characterisation/setup.ts"],
  },
});
