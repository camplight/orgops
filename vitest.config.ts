import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          exclude: [...configDefaults.exclude, "apps/opscli/test/**", "apps/user-ui/**"],
        },
      },
      "apps/user-ui",
    ],
  },
});
