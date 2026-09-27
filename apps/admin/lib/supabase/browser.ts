"use client";

import { createBrowserClient } from "@supabase/ssr";

import { adminCookieOptions } from "@/lib/supabase/cookie";

export function createAdminBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Admin Supabase configuration missing.");
  return createBrowserClient(url, key, { cookieOptions: adminCookieOptions });
}
