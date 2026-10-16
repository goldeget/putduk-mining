"use client";

import { createBrowserClient } from "@supabase/ssr";

import { adminCookieOptions } from "@/lib/supabase/cookie";
import { parseSupabaseBrowserAuthConfig } from "../../../../lib/env/public";

export type AdminPublicBrowserConfig = {
  url: string;
  publishableKey: string;
};

export function createAdminBrowserClient(config?: AdminPublicBrowserConfig) {
  const url = config?.url ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    config?.publishableKey ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Admin Supabase configuration missing.");
  // Validate the same target and public-only tuple as the member browser.
  const admitted = parseSupabaseBrowserAuthConfig({ url, publishableKey: key });
  return createBrowserClient(admitted.url, admitted.publishableKey, {
    cookieOptions: adminCookieOptions,
  });
}
