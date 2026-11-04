import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Focused replacement tests. The existing full CI/release configuration remains intact.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      "server-only": fileURLToPath(
        new URL(
          "./node_modules/next/dist/compiled/server-only/empty.js",
          import.meta.url,
        ),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/workroom*.test.ts"],
    maxWorkers: 2,
  },
});
