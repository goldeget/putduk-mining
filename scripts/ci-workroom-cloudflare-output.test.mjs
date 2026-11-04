import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  inventory,
  adaptPreviewCsp,
  localConfig,
  productionConfig,
} from "./ci-workroom-cloudflare-output.mjs";
const text = (value) => ({ type: "text", value });
const production = () => ({
  name: "putduk-mining-web-staging",
  manifest: { type: "partial", mainModule: "index.js", modules: {} },
  env: {
    APP_ENV: text("production"),
    NEXT_PUBLIC_SUPABASE_URL: text("https://osrmyjgmpdspdcwqjwuv.supabase.co"),
    AI_PROVIDER_DISPATCH_ENABLED: text("false"),
  },
});
const env = {
  APP_ENV: "test",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:63421",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_fixture",
  SUPABASE_SECRET_KEY: "private-local-fixture-only",
};
test("private local text override leaves deploy config exact and keeps secret out of review", () => {
  const original = production(),
    before = JSON.stringify(original),
    local = localConfig(original, env, 3000);
  assert.equal(JSON.stringify(original), before);
  assert.equal(local.env.APP_ENV.value, "test");
  assert.equal(
    local.env.NEXT_PUBLIC_SUPABASE_URL.value,
    env.NEXT_PUBLIC_SUPABASE_URL,
  );
  assert.equal(local.env.SUPABASE_SECRET_KEY.value, env.SUPABASE_SECRET_KEY);
  assert.equal(local.env.WORKROOM_LOCAL_PREVIEW_ONLY.value, "true");
  assert.match(local.name, /local-preview-only/);
});
test("production URL or non-test runtime fails before preview", () => {
  for (const bad of [
    { ...env, APP_ENV: "production" },
    {
      ...env,
      NEXT_PUBLIC_SUPABASE_URL: "https://osrmyjgmpdspdcwqjwuv.supabase.co",
    },
    { ...env, SUPABASE_SECRET_KEY: "" },
  ])
    assert.throws(() => localConfig(production(), bad, 3000), /LOCAL_BINDINGS/);
});
test("deploy artifact rejects local binding and embedded secret", () => {
  assert.doesNotThrow(() =>
    productionConfig(production(), "putduk-mining-web-staging"),
  );
  const local = production();
  local.env.APP_ENV = text("test");
  assert.throws(() => productionConfig(local, local.name), /PRODUCTION_OUTPUT/);
  const secret = production();
  secret.env.SUPABASE_SECRET_KEY = text("sb_secret_forbidden");
  assert.throws(() => productionConfig(secret, secret.name), /BUILD_SECRET/);
});
test("inventory hashes exact bytes and rejects empty or symlink output", () => {
  const root = mkdtempSync(join(tmpdir(), "workroom-output-test-"));
  try {
    mkdirSync(join(root, "bundle"));
    writeFileSync(join(root, "bundle", "entry.js"), "export default {}");
    const first = inventory(root);
    assert.equal(first[0].path, "bundle/entry.js");
    writeFileSync(
      join(root, "bundle", "entry.js"),
      "export default {changed:true}",
    );
    assert.notEqual(inventory(root)[0].sha256, first[0].sha256);
    writeFileSync(join(root, "empty"), "");
    assert.throws(() => inventory(root), /OUTPUT_EMPTY/);
    rmSync(join(root, "empty"));
    if (process.platform !== "win32") {
      symlinkSync(join(root, "bundle", "entry.js"), join(root, "link"));
      assert.throws(() => inventory(root), /OUTPUT_SYMLINK/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("local CSP adapter requires exact real production CSP and preserves every other directive", async () => {
  const { buildPublicContentSecurityPolicy } =
    await import("../lib/support/csp.ts");
  const { buildAdminContentSecurityPolicy } =
    await import("../apps/admin/lib/content-security-policy.ts");
  for (const build of [
    buildPublicContentSecurityPolicy,
    buildAdminContentSecurityPolicy,
  ]) {
    const production = build({
      appEnv: "production",
      nodeEnv: "production",
      supabaseUrl: "https://osrmyjgmpdspdcwqjwuv.supabase.co",
    });
    const local = adaptPreviewCsp(production, production);
    assert.equal(
      local.replace(" http://127.0.0.1:63421 ws://127.0.0.1:63421", "") +
        "; upgrade-insecure-requests",
      production,
    );
    assert.ok(local.includes("object-src 'none'"));
    assert.ok(local.includes("frame-ancestors 'none'"));
    assert.ok(!local.includes("unsafe-eval"));
    for (const value of [
      null,
      "",
      production.replace("object-src 'none'", "object-src *"),
      production + "; script-src *",
    ])
      assert.throws(() => adaptPreviewCsp(value, production), /PRODUCTION_CSP/);
  }
});
