import "server-only";

import { z } from "zod";

import { isPublicSupabaseKey } from "../../../lib/env/public";

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
  const parsed = schema.parse({
    APP_ENV: process.env.APP_ENV,
    NEXT_PUBLIC_SUPABASE_URL: runtimeEnv.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      runtimeEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    ADMIN_APP_URL: process.env.ADMIN_APP_URL,
  });
  // 브라우저로 넘기는 공개 키는 service role을 거절한다.
  if (!isPublicSupabaseKey(parsed.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)) {
    throw new Error("SUPABASE_BROWSER_CONFIG_INVALID");
  }
  return parsed;
}
