const TARGETS = Object.freeze({
  landing: { name: "putduk-web", origin: "https://putduk.com" },
  member: {
    name: "putduk-mining-web-staging",
    origin: "https://mining.putduk.com",
  },
  admin: {
    name: "putduk-mining-admin-staging",
    origin: "https://admin.mining.putduk.com",
  },
});

/** Explicit release modes only; the ordinary production CI build stays unchanged. */
export function productionTarget(mode, app) {
  if (mode === undefined || mode === "production" || !/^prod/i.test(mode))
    return undefined;
  const role = mode.slice("production-".length);
  if (
    mode !== `production-${role}` ||
    !Object.hasOwn(TARGETS, role) ||
    (app === "admin" ? role !== "admin" : !["landing", "member"].includes(role))
  )
    throw new Error("PRODUCTION_BLOCKED: explicit mode and app must agree");
  return { role, ...TARGETS[role] };
}

/** Public inputs only. Server secrets are declared separately for opaque inheritance. */
export function productionValues(key, role) {
  if (
    !Object.hasOwn(TARGETS, role) ||
    typeof key !== "string" ||
    !/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(key)
  )
    throw new Error(
      "PRODUCTION_BLOCKED: original-project publishable key required",
    );
  return {
    APP_ENV: "production",
    APP_TIMEZONE: "UTC",
    NEXT_PUBLIC_APP_URL: TARGETS[role].origin,
    ADMIN_APP_URL: TARGETS.admin.origin,
    NEXT_PUBLIC_SUPABASE_URL: "https://osrmyjgmpdspdcwqjwuv.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
    AI_PROVIDER_DISPATCH_ENABLED: "false",
  };
}
