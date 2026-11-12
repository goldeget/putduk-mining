"use client";
import { useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { SupabaseBrowserAuthConfig } from "@/lib/env/public";

/** Mount on every signed-in page so the SDK can renew tokens while the page is open. */
export function MemberSessionRuntime({
  config,
}: {
  config: SupabaseBrowserAuthConfig;
}) {
  const { url, publishableKey } = config;
  useEffect(() => {
    const browser = createSupabaseBrowserClient({ url, publishableKey });
    const { data } = browser.auth.onAuthStateChange(() => {});
    return () => data.subscription.unsubscribe();
  }, [url, publishableKey]);
  return null;
}
