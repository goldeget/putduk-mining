import { z } from "zod";

const optionalPublicString = <T extends z.ZodType<string>>(schema: T) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    schema.optional(),
  );

const channelTalkPluginKey = z.preprocess((value) => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return /^[A-Za-z0-9_-]{8,80}$/.test(trimmed) ? trimmed : undefined;
}, z.string().optional());

const publicEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: optionalPublicString(z.string().min(20)),
  NEXT_PUBLIC_CHANNEL_TALK_PLUGIN_KEY: channelTalkPluginKey,
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export type SupabaseBrowserAuthConfig = {
  url: string;
  publishableKey: string;
};

const approvedSupabaseHost = "osrmyjgmpdspdcwqjwuv.supabase.co";
const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);

function isApprovedSupabaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !["", "/"].includes(url.pathname)
    )
      return false;
    return (
      (url.protocol === "https:" &&
        url.hostname === approvedSupabaseHost &&
        !url.port) ||
      (url.protocol === "http:" &&
        loopbackHosts.has(url.hostname) &&
        !!url.port)
    );
  } catch {
    return false;
  }
}

export function isPublicSupabaseKey(value: string): boolean {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(value)) return true;
  // Local Supabase also supports legacy anon JWT keys. Never serialize a
  // service_role JWT or an opaque sb_secret key as public runtime configuration.
  const parts = value.split(".");
  if (
    parts.length !== 3 ||
    !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))
  )
    return false;
  try {
    const payload = JSON.parse(
      atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/")),
    ) as { role?: unknown };
    return payload.role === "anon";
  } catch {
    return false;
  }
}

const browserAuthConfigSchema = z.strictObject({
  url: z.url().refine(isApprovedSupabaseUrl),
  publishableKey: z.string().min(20).max(4096).refine(isPublicSupabaseKey),
});

/** Only these two public values may cross the server/client auth boundary. */
export function parseSupabaseBrowserAuthConfig(
  value: unknown,
): SupabaseBrowserAuthConfig {
  const parsed = browserAuthConfigSchema.safeParse(value);
  if (!parsed.success) throw new Error("SUPABASE_BROWSER_CONFIG_INVALID");
  return parsed.data;
}

export function getPublicEnv(): PublicEnv {
  // These callers run on the server. An env alias preserves runtime values
  // when one prebuilt app is used by independently configured E2E shards.
  const runtimeEnv = process.env;
  return publicEnvSchema.parse({
    NEXT_PUBLIC_APP_URL: runtimeEnv.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: runtimeEnv.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      runtimeEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: runtimeEnv.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    NEXT_PUBLIC_CHANNEL_TALK_PLUGIN_KEY:
      runtimeEnv.NEXT_PUBLIC_CHANNEL_TALK_PLUGIN_KEY,
  });
}
