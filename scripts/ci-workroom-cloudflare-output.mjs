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
  const overrides = {
    APP_ENV: "test",
    NEXT_PUBLIC_APP_ENV: "test",
    NEXT_PUBLIC_APP_URL: "http://127.0.0.1:" + port,
    ADMIN_APP_URL: "http://127.0.0.1:3100",
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
