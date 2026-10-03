import type { ReactNode } from "react";
import { randomUUID } from "node:crypto";

import { ProductShell } from "@/components/layout/product-shell";
import { PutdukAiSessionProvider } from "@/components/product/putduk-ai-session";
import { getAiAvailability } from "@/lib/ai/availability";
import { requirePageUser } from "@/lib/auth/session";
import { getSupabaseBrowserAuthConfig } from "@/lib/env/supabase-browser.server";

export const dynamic = "force-dynamic";

export default async function ProductLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const identity = await requirePageUser();
  const { data: profile } = await identity.supabase
    .from("user_profiles")
    .select("display_name")
    .eq("user_id", identity.userId)
    .maybeSingle();
  const aiAvailability = getAiAvailability();

  return (
    <PutdukAiSessionProvider
      ownerUserId={identity.userId}
      ownerVerificationId={randomUUID()}
      browserAuthConfig={getSupabaseBrowserAuthConfig()}
      {...aiAvailability}
    >
      <ProductShell displayName={profile?.display_name ?? "퍼뜩 회원"}>
        {children}
      </ProductShell>
    </PutdukAiSessionProvider>
  );
}
