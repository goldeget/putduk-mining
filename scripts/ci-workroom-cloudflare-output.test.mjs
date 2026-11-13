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
  safeWorkerdError,
  localConfig,
  productionConfig,
} from "./ci-workroom-cloudflare-output.mjs";
const text = (value) => ({ type: "text", value });
const production = () => ({
  name: "putduk-mining-web-staging",
  exports: {
    WorkroomMemberAlarm: { type: "durable-object", storage: "sqlite" },
  },
  triggers: [{ type: "scheduled", schedule: "* * * * *" }],
  manifest: { type: "partial", mainModule: "index.js", modules: {} },
  env: {
    WORKROOM_APP_RUNTIME_ENABLED: text("false"),
    WORKROOM_MEMBER_ALARMS: {
      type: "durable-object",
      worker: "putduk-mining-web-staging",
      exportName: "WorkroomMemberAlarm",
    },
    APP_ENV: text("production"),
    NEXT_PUBLIC_APP_URL: text("https://workroom.putduk.com"),
    ADMIN_APP_URL: text("https://admin.workroom.putduk.com"),
    NEXT_PUBLIC_SUPABASE_URL: text("https://awrubjiqkggaxcvtckbr.supabase.co"),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: text(
      "sb_publishable_GLyun5wTHeFb0vEjug52Mw_l4G9JqZx",
    ),
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
  assert.equal(local.env.WORKROOM_MEMBER_ALARMS.worker, local.name);
  assert.equal(local.env.WORKROOM_APP_RUNTIME_ENABLED.value, "false");
});
test("private admin preview matches the exact loopback request origin", () => {
  const admin = localConfig(production(), env, 3100);
  assert.equal(admin.env.NEXT_PUBLIC_APP_URL.value, "http://127.0.0.1:3100");
  assert.equal(admin.env.ADMIN_APP_URL.value, "http://127.0.0.1:3100");
});
test("production URL or non-test runtime fails before preview", () => {
  for (const bad of [
    { ...env, APP_ENV: "production" },
    {
      ...env,
      NEXT_PUBLIC_SUPABASE_URL: "https://awrubjiqkggaxcvtckbr.supabase.co",
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

test("deploy artifact rejects the retired backend and a mismatched public key", () => {
  const retired = production();
  retired.env.NEXT_PUBLIC_SUPABASE_URL = text(
    "https://osrmyjgmpdspdcwqjwuv.supabase.co",
  );
  assert.throws(
    () => productionConfig(retired, retired.name),
    /PRODUCTION_OUTPUT/,
  );
  const mismatched = production();
  mismatched.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = text(
    "sb_publishable_Pc0iVt3ubpnsRTNxbJ1KCg_kK76qtv-",
  );
  assert.throws(
    () => productionConfig(mismatched, mismatched.name),
    /PRODUCTION_OUTPUT/,
  );
});
test("deploy artifact admits only exact WORKROOM origins for the two existing Workers", () => {
  for (const [name, origin] of [
    ["putduk-mining-web-staging", "https://workroom.putduk.com"],
    ["putduk-mining-admin-staging", "https://admin.workroom.putduk.com"],
  ]) {
    const config = production();
    config.name = name;
    if (name === "putduk-mining-admin-staging") {
      delete config.env.WORKROOM_MEMBER_ALARMS;
      delete config.env.WORKROOM_APP_RUNTIME_ENABLED;
      delete config.exports;
      delete config.triggers;
    }
    config.env.NEXT_PUBLIC_APP_URL = text(origin);
    assert.doesNotThrow(() => productionConfig(config, name));
    for (const bad of [
      undefined,
      "https://mining.putduk.com",
      "https://admin.mining.putduk.com",
      `${origin}:444`,
      "https://evil.example",
    ]) {
      const stale = structuredClone(config);
      if (bad === undefined) delete stale.env.NEXT_PUBLIC_APP_URL;
      else stale.env.NEXT_PUBLIC_APP_URL = text(bad);
      assert.throws(() => productionConfig(stale, name), /PRODUCTION_OUTPUT/);
    }
    const swapped = structuredClone(config);
    swapped.env.NEXT_PUBLIC_APP_URL = text(
      origin === "https://workroom.putduk.com"
        ? "https://admin.workroom.putduk.com"
        : "https://workroom.putduk.com",
    );
    assert.throws(() => productionConfig(swapped, name), /PRODUCTION_OUTPUT/);
    const wrongAdmin = structuredClone(config);
    wrongAdmin.env.ADMIN_APP_URL = text("https://admin.mining.putduk.com");
    assert.throws(
      () => productionConfig(wrongAdmin, name),
      /PRODUCTION_OUTPUT/,
    );
  }
  const otherWorker = production();
  otherWorker.name = "unrelated-worker";
  assert.throws(
    () => productionConfig(otherWorker, otherWorker.name),
    /PRODUCTION_OUTPUT/,
  );
});

test("scheduler admission allows exactly the existing member SQLite class and minute recovery", () => {
  for (const alter of [
    (config) => {
      config.env.WORKROOM_MEMBER_ALARMS.worker = "unrelated-worker";
    },
    (config) => {
      config.env.WORKROOM_MEMBER_ALARMS.exportName = "OtherClass";
    },
    (config) => {
      config.exports.WorkroomMemberAlarm.storage = "legacy-kv";
    },
    (config) => {
      config.exports.OtherClass = { type: "durable-object", storage: "sqlite" };
    },
    (config) => {
      config.triggers[0].schedule = "*/2 * * * *";
    },
    (config) => {
      config.env.WORKROOM_APP_RUNTIME_ENABLED.value = "true";
    },
    (config) => {
      delete config.env.WORKROOM_MEMBER_ALARMS;
    },
  ]) {
    const config = production();
    alter(config);
    assert.throws(
      () => productionConfig(config, config.name),
      /SCHEDULER_CONFIG/,
    );
  }
  const extra = production();
  extra.env.OTHER_DO = {
    type: "durable-object",
    worker: extra.name,
    exportName: "WorkroomMemberAlarm",
  };
  assert.throws(
    () => productionConfig(extra, extra.name),
    /UNREVIEWED_BINDING/,
  );
  const external = production();
  external.env.WORKROOM_MEMBER_ALARMS.worker = "unrelated-worker";
  assert.throws(
    () => localConfig(external, env, 3000),
    /LOCAL_ALARM_BINDING_INVALID/,
  );
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
      supabaseUrl: "https://awrubjiqkggaxcvtckbr.supabase.co",
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

test("workerd failure diagnostics expose only fixed classes and compiled stack locations", () => {
  const secret = "sb_secret_private_password_and_token";
  const error = new TypeError("Cannot read properties of undefined " + secret);
  error.stack =
    "TypeError: " +
    secret +
    "\n at fetch (/bundle/index-Ab123.js:25:7)\n at secret " +
    secret;
  const result = safeWorkerdError(error);
  assert.equal(result.kind, "undefined-property");
  assert.deepEqual(result.frames, [
    { file: "index-Ab123.js", line: 25, column: 7 },
  ]);
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.equal(safeWorkerdError({ message: secret }).kind, "unclassified");
});

test("local clone removes the complete inherited production AI provider group without fake keys", () => {
  const original = production();
  original.env.AI_PROVIDER = text("nvidia");
  original.env.AI_MODEL_LOW_COST = text("openai/gpt-oss-20b");
  original.env.AI_API_KEY = { type: "secret" };
  const before = JSON.stringify(original),
    local = localConfig(original, env, 3000);
  for (const name of ["AI_PROVIDER", "AI_MODEL_LOW_COST", "AI_API_KEY"])
    assert.equal(local.env[name], undefined);
  assert.equal(local.env.AI_PROVIDER_DISPATCH_ENABLED.value, "false");
  assert.equal(local.env.APP_TIMEZONE.value, "UTC");
  assert.equal(JSON.stringify(original), before);
});
test("Zod diagnostic records only reviewed environment paths and standard codes", () => {
  const secret = "sb_secret_do_not_log";
  const result = safeWorkerdError({
    name: "ZodError",
    message: secret,
    issues: [
      { path: ["AI_API_KEY"], code: "custom", message: secret, input: secret },
      { path: [secret], code: secret, message: secret },
    ],
  });
  assert.deepEqual(result.issues, [
    { path: "AI_API_KEY", code: "custom" },
    { path: "unrecognized-env-path", code: "unrecognized-code" },
  ]);
  assert.ok(!JSON.stringify(result).includes(secret));
});
