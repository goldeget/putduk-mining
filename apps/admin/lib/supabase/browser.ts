"use client";

import { createBrowserClient } from "@supabase/ssr";

import { adminCookieOptions } from "@/lib/supabase/cookie";
import { isPublicSupabaseKey } from "../../../../lib/env/public";

export type AdminPublicBrowserConfig = {
  url: string;
  publishableKey: string;
};

export function createAdminBrowserClient(config?: AdminPublicBrowserConfig) {
  const url = config?.url ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    config?.publishableKey ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Admin Supabase configuration missing.");
  // 회원 앱과 같은 공개 키 역할 검사만 적용한다.
  if (!isPublicSupabaseKey(key)) {
    throw new Error("SUPABASE_BROWSER_CONFIG_INVALID");
  }
  return createBrowserClient(url, key, { cookieOptions: adminCookieOptions });
}
