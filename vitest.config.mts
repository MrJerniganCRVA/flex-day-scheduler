import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Unit tests only — no database, no browser, no Next.js runtime. The suite
 * targets the pure logic where a silent mistake is most expensive: the
 * hand-rolled DST-aware deadline math, and the participation/coverage
 * derivations that decide what admins see.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
