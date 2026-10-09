import assert from "node:assert/strict";
import { test } from "node:test";
import { needsAdminWebServer } from "./e2e-admin-server.mjs";

test("an explicit all-member money selection omits the Admin server", () => {
  assert.equal(
    needsAdminWebServer(
      [
        "first-krw-withdrawal.spec.ts",
        "tests/e2e/authenticated/first-usdt-withdrawal.spec.ts",
      ],
      {},
    ),
    false,
  );
});
test("mixing a member spec with principal or newer Admin specs retains Admin", () => {
  for (const spec of [
    "principal-withdrawal-product.spec.ts",
    "admin-members-product.spec.ts",
  ])
    assert.equal(
      needsAdminWebServer(["first-krw-withdrawal.spec.ts", spec], {}),
      true,
    );
});
test("grep-only and shard-list selections conservatively retain Admin", () => {
  assert.equal(
    needsAdminWebServer(["--grep", "first-krw-withdrawal"], {}),
    true,
  );
  assert.equal(
    needsAdminWebServer(["--test-list", "/tmp/putduk-shard.txt"], {}),
    true,
  );
});
test("existing explicit flags retain their precedence", () => {
  assert.equal(
    needsAdminWebServer(["first-krw-withdrawal.spec.ts"], {
      E2E_WITH_ADMIN_SERVER: "1",
    }),
    true,
  );
  assert.equal(needsAdminWebServer([], { E2E_SKIP_ADMIN_SERVER: "1" }), false);
  assert.equal(
    needsAdminWebServer([], {
      E2E_WITH_ADMIN_SERVER: "1",
      E2E_SKIP_ADMIN_SERVER: "1",
    }),
    true,
  );
});
