import { defineConfig } from "vitest/config";

// Exercise the published files in place. No replacement drawing data or mocks
// of application modules are supplied by this portfolio configuration.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    include: [
      "projects/sprink-source/sprink/apps/web/src/workbench/ask/*.test.ts",
      "projects/sprink-source/sprink/apps/web/src/workbench/locale.test.ts",
      "projects/sprink-source/sprink/apps/web/src/workbench/workflows.test.ts"
    ],
    testTimeout: 15000
  }
});
