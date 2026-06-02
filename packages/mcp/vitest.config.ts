import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@eventloom/runtime": new URL("../../src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
