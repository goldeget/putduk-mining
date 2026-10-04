"use client";

import { createBrowserClient } from "@supabase/ssr";

import {
  parseSupabaseBrowserAuthConfig,
  type SupabaseBrowserAuthConfig,
} from "@/lib/env/public";

export function createSupabaseBrowserClient(config: SupabaseBrowserAuthConfig) {
  const { url, publishableKey } = parseSupabaseBrowserAuthConfig(config);

  return createBrowserClient(url, publishableKey);
}
