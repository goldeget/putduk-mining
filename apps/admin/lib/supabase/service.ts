import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getAdminEnv } from "@/lib/env";

export function createAdminServiceClient() {
  const env = getAdminEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
