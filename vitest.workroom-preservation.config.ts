import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
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
    maxWorkers: 2,
    include: [
      "tests/unit/workroom*.test.ts",
      "tests/unit/balanced-ledger.test.ts",
      "tests/unit/ledger.test.ts",
      "tests/unit/money-provenance.test.ts",
      "tests/unit/welcome-reward.test.ts",
      "tests/unit/signup-phone-fail-closed.test.ts",
      "tests/unit/signup-availability-recovery.test.ts",
      "tests/unit/signup-reconstruction.test.ts",
    ],
  },
});
