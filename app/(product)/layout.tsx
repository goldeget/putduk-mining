import type { ReactNode } from "react";

import { ProductShell } from "@/components/layout/product-shell";
import { requirePageUser } from "@/lib/auth/session";

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

  return (
    <ProductShell displayName={profile?.display_name ?? "PUTDUK MEMBER"}>
      {children}
    </ProductShell>
  );
}
