/** Immutable deploy artifact inventory; local preview configuration is never deploy output. */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, lstatSync } from "node:fs";
import { resolve, relative } from "node:path";
export const sha256 = (b) => createHash("sha256").update(b).digest("hex");
export function inventory(root) {
  const rows = [];
  function walk(dir) {
    for (const name of readdirSync(dir).sort()) {
      const path = resolve(dir, name),
        stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw Error("WORKROOM_OUTPUT_SYMLINK");
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) {
        const bytes = readFileSync(path);
        if (!bytes.length)
          throw Error("WORKROOM_OUTPUT_EMPTY:" + relative(root, path));
        rows.push({
          path: relative(root, path).replaceAll("\\", "/"),
          bytes: bytes.length,
          sha256: sha256(bytes),
        });
      } else throw Error("WORKROOM_OUTPUT_TYPE");
    }
  }
  walk(resolve(root));
  if (!rows.length) throw Error("WORKROOM_OUTPUT_MISSING");
  return rows;
}
export function productionConfig(config, name) {
  const values = config.env ?? {};
  if (
    config.name !== name ||
    values.APP_ENV?.value !== "production" ||
    values.NEXT_PUBLIC_SUPABASE_URL?.value !==
      "https://osrmyjgmpdspdcwqjwuv.supabase.co" ||
    values.AI_PROVIDER_DISPATCH_ENABLED?.value !== "false" ||
    !config.manifest?.mainModule
  )
    throw Error("WORKROOM_PRODUCTION_OUTPUT_CONFIG");
  for (const [key, value] of Object.entries(values)) {
    if (value.type !== "text" && value.type !== "secret")
      throw Error("WORKROOM_UNREVIEWED_BINDING:" + key);
    if (
      value.type === "text" &&
      (/SECRET|PASSWORD|TOKEN/.test(key) ||
        String(value.value).includes("sb_secret_"))
    )
      throw Error("WORKROOM_BUILD_SECRET");
  }
  return values;
}
export function localConfig(config, env, port) {
  if (
    env.APP_ENV !== "test" ||
    env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:63421" ||
    !env.SUPABASE_SECRET_KEY ||
    !env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  )
    throw Error("WORKROOM_LOCAL_BINDINGS_REQUIRED");
  const clone = structuredClone(config);
  // Local provider dispatch is disabled with no partial production group or fabricated key.
  for (const name of [
    "AI_PROVIDER",
    "AI_MODEL_LOW_COST",
    "AI_MODEL_HIGH_CAPABILITY",
    "AI_API_KEY",
    "NVIDIA_API_KEY",
    "OPENAI_API_KEY",
    "OPENROUTER_FREE_API_KEY",
    "OPENROUTER_API_KEY",
    "AI_PAID_CALL_AUTHORIZED",
  ])
    delete clone.env[name];
  const overrides = {
    APP_ENV: "test",
    APP_TIMEZONE: "UTC",
    NEXT_PUBLIC_APP_ENV: "test",
    NEXT_PUBLIC_APP_URL:
      port === 3100 ? "http://localhost:3100" : "http://127.0.0.1:" + port,
    ADMIN_APP_URL: "http://localhost:3100",
    NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: env.SUPABASE_SECRET_KEY,
    CHANNEL_TALK_MEMBER_HASH_SECRET: env.CHANNEL_TALK_MEMBER_HASH_SECRET,
    AI_PROVIDER_DISPATCH_ENABLED: "false",
    WORKROOM_LOCAL_PREVIEW_ONLY: "true",
  };
  for (const [name, value] of Object.entries(overrides))
    if (value !== undefined) clone.env[name] = { type: "text", value };
  clone.name = "workroom-local-preview-only-" + port;
  return clone;
}

export function adaptPreviewCsp(value, expected) {
  if (
    !value ||
    value !== expected ||
    !value.includes("default-src 'self'") ||
    !value.includes("object-src 'none'") ||
    !value.includes("frame-ancestors 'none'") ||
    value.includes("unsafe-eval") ||
    value.includes("127.0.0.1") ||
    value.includes("localhost")
  )
    throw Error("WORKROOM_EXACT_PRODUCTION_CSP_REQUIRED");
  const directives = value.split("; "),
    connect = directives.findIndex((d) => d.startsWith("connect-src ")),
    upgrade = directives.indexOf("upgrade-insecure-requests");
  if (
    connect < 0 ||
    upgrade < 0 ||
    directives.filter((d) => d.startsWith("connect-src ")).length !== 1
  )
    throw Error("WORKROOM_CSP_DIRECTIVE_ROSTER");
  const local = [...directives];
  local[connect] += " http://127.0.0.1:63421 ws://127.0.0.1:63421";
  local.splice(upgrade, 1);
  const inverse = [...local];
  const target = inverse.findIndex((d) => d.startsWith("connect-src "));
  inverse[target] = inverse[target].replace(
    " http://127.0.0.1:63421 ws://127.0.0.1:63421",
    "",
  );
  inverse.splice(upgrade, 0, "upgrade-insecure-requests");
  if (inverse.join("; ") !== value) throw Error("WORKROOM_CSP_INVERSE_CHANGED");
  return local.join("; ");
}

export function safeWorkerdError(error) {
  const message = String(error?.message ?? error ?? "");
  const allowed = [
    ["fetch-export-shape", /original\.fetch.*not a function/i],
    ["missing-module", /cannot find module|module.*not found|no such module/i],
    ["dynamic-require", /dynamic require|require is not defined/i],
    ["missing-process", /process is not defined/i],
    ["missing-assets-binding", /ASSETS.*(?:undefined|missing|not configured)/i],
    ["invalid-url", /invalid url/i],
    ["undefined-property", /cannot read propert/i],
    ["nonfunction", /is not a function/i],
    [
      "environment-validation",
      /invalid environment|ZodError|SUPABASE.*required/i,
    ],
  ];
  const code = /\bWORKROOM_[A-Z_]+\b/.exec(message)?.[0];
  const kind =
    code ??
    allowed.find(([, pattern]) => pattern.test(message))?.[0] ??
    "unclassified";
  const frames = [
    ...String(error?.stack ?? "").matchAll(
      /(?:^|[/\\])([A-Za-z0-9_.-]+\.(?:m?js)):(\d+):(\d+)/g,
    ),
  ]
    .slice(0, 4)
    .map((m) => ({ file: m[1], line: Number(m[2]), column: Number(m[3]) }));
  const allowedEnv = new Set([
    "APP_ENV",
    "APP_TIMEZONE",
    "SUPABASE_SECRET_KEY",
    "WITHDRAWAL_DATA_KEY",
    "VAPID_PRIVATE_KEY",
    "VAPID_SUBJECT",
    "AI_PROVIDER",
    "AI_PROVIDER_DISPATCH_ENABLED",
    "AI_PAID_CALL_AUTHORIZED",
    "AI_API_KEY",
    "NVIDIA_API_KEY",
    "OPENROUTER_FREE_API_KEY",
    "OPENROUTER_API_KEY",
    "AI_FIRST_TOKEN_TIMEOUT_MS",
    "AI_MODEL_LOW_COST",
    "AI_MODEL_HIGH_CAPABILITY",
    "AI_MAX_OUTPUT_TOKENS",
    "AI_MAX_REQUESTS_PER_MINUTE",
    "AI_MAX_REQUESTS_PER_DAY",
    "AI_CACHE_TTL_SECONDS",
    "NEXT_PUBLIC_APP_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
    "NEXT_PUBLIC_CHANNEL_TALK_PLUGIN_KEY",
    "ADMIN_APP_URL",
    "CHANNEL_TALK_MEMBER_HASH_SECRET",
  ]);
  const standardCodes = new Set([
    "invalid_type",
    "invalid_value",
    "too_small",
    "too_big",
    "invalid_format",
    "unrecognized_keys",
    "custom",
    "not_multiple_of",
    "invalid_union",
    "invalid_key",
    "invalid_element",
  ]);
  const issues =
    error?.name === "ZodError" && Array.isArray(error.issues)
      ? error.issues.slice(0, 16).map((issue) => ({
          path: allowedEnv.has(issue?.path?.[0])
            ? issue.path[0]
            : "unrecognized-env-path",
          code: standardCodes.has(issue?.code)
            ? issue.code
            : "unrecognized-code",
        }))
      : [];
  return {
    name: [
      "Error",
      "TypeError",
      "ReferenceError",
      "SyntaxError",
      "ZodError",
    ].includes(error?.name)
      ? error.name
      : "unknown",
    kind,
    frames,
    issues,
  };
}
