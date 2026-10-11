import "server-only";

import { z } from "zod";

import { parseSupabaseBrowserAuthConfig } from "../../../lib/env/public";

const schema = z.object({
  APP_ENV: z.enum(["development", "test", "staging", "production"]),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  SUPABASE_SECRET_KEY: z.string().min(20),
  ADMIN_APP_URL: z.url(),
});

export type AdminEnv = z.infer<typeof schema>;

export function getAdminEnv(): AdminEnv {
  // Read public values at server runtime when a build is promoted across targets.
  const runtimeEnv = process.env;
  return schema.parse({
    APP_ENV: process.env.APP_ENV,
    NEXT_PUBLIC_SUPABASE_URL: runtimeEnv.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      runtimeEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    ADMIN_APP_URL: process.env.ADMIN_APP_URL,
  });
}

/** Validate before RSC/HTML serialization; client checks alone are too late. */
export function getAdminBrowserPublicConfig() {
  const env = getAdminEnv();
  return parseSupabaseBrowserAuthConfig({
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}
