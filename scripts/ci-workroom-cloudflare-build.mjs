import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  inventory,
  productionConfig,
} from "./ci-workroom-cloudflare-output.mjs";
import { makeReceipt } from "./ci-workroom-evidence.mjs";
if (
  process.env.GITHUB_ACTIONS !== "true" ||
  process.env.GITHUB_REPOSITORY !== "goldeget/putduk-mining"
)
  throw Error("WORKROOM_HOSTED_BUILD_REQUIRED");
execFileSync(
  process.execPath,
  ["scripts/workroom-source-integrity.mjs", "--verify", "--require-clean"],
  { stdio: "inherit" },
);
const startedAt = Date.now(),
  files = [],
  review = [];
for (const [dir, name] of [
  [".", "putduk-mining-web-staging"],
  ["apps/admin", "putduk-mining-admin-staging"],
]) {
  const env = {
    ...process.env,
    APP_ENV: "production",
    NEXT_PUBLIC_APP_ENV: "production",
    NEXT_PUBLIC_APP_URL:
      dir === "."
        ? "https://mining.putduk.com"
        : "https://admin.mining.putduk.com",
    ADMIN_APP_URL: "https://admin.mining.putduk.com",
    NEXT_PUBLIC_SUPABASE_URL: "https://osrmyjgmpdspdcwqjwuv.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      "sb_publishable_Pc0iVt3ubpnsRTNxbJ1KCg_kK76qtv-",
    AI_PROVIDER_DISPATCH_ENABLED: "false",
  };
  for (const key of Object.keys(env))
    if (
      /SUPABASE_SECRET|SERVICE_ROLE|CLOUDFLARE_API|CF_API|AUTH_TOKEN/.test(key)
    )
      delete env[key];
  execFileSync("pnpm", ["--dir", dir, "exec", "vite", "build"], {
    stdio: "inherit",
    env,
  });
  const root =
    dir === "." ? ".cloudflare/output/v0" : dir + "/.cloudflare/output/v0";
  const rootConfig = JSON.parse(readFileSync(root + "/config.json", "utf8"));
  if (rootConfig.accountId !== "9dc502d4ef06b3b5374591de6e6933ca")
    throw Error("WORKROOM_OUTPUT_ACCOUNT");
  const config = JSON.parse(
    readFileSync(root + "/workers/default/worker.config.json", "utf8"),
  );
  const bindings = productionConfig(config, name),
    rows = inventory(root);
  if (
    !rows.some((r) => r.path.includes("/bundle/") && r.path.endsWith(".js")) ||
    !rows.some((r) => r.path.includes("/assets/"))
  )
    throw Error("WORKROOM_DEPLOY_OUTPUT_INCOMPLETE");
  for (const row of rows) files.push(root + "/" + row.path);
  review.push({
    root,
    name,
    bindings,
    inventory: rows,
    publicBuildEnvironment: {
      APP_ENV: env.APP_ENV,
      NEXT_PUBLIC_APP_ENV: env.NEXT_PUBLIC_APP_ENV,
      NEXT_PUBLIC_APP_URL: env.NEXT_PUBLIC_APP_URL,
      NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    },
    secrets: "Inherited at eventual deploy; none supplied to build",
    runtime:
      "workerd acceptance uses private local clone; deployment output stays production",
  });
}
mkdirSync("test-results/workroom-cloudflare-build", { recursive: true });
const reviewPath = "test-results/workroom-cloudflare-build/output-review.json";
writeFileSync(reviewPath, JSON.stringify(review, null, 2) + "\n");
writeFileSync(
  "test-results/workroom-cloudflare-build/receipt.json",
  JSON.stringify(
    makeReceipt({
      gate: "cloudflare-build",
      startedAt,
      files: [...files, reviewPath],
    }),
    null,
    2,
  ) + "\n",
);
